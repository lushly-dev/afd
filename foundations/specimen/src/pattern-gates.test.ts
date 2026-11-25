import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { coverageRunSchema, gateRunSchema, suggestRunSchema, suiteRunSchema } from './schema.js';
import type { GateRun, PatternFile } from './types.js';

const packLibrary = resolve(import.meta.dirname, '../fixtures/pack-library');
const selectFixture = JSON.stringify(join(packLibrary, 'select.js'));
const fieldFixture = JSON.stringify(join(packLibrary, 'field.js'));

const SELECT_PATTERN: PatternFile = {
	pattern: 'select',
	summary: 'Choose one option from a short list.',
	status: 'stable',
	scope: 'control',
	facets: { purpose: ['single-choice'], structure: ['popup'] },
	keep: [
		{ id: 'select.keep.named', text: 'Has an accessible name and starts closed.', gate: 'named' },
		{
			id: 'select.keep.escape-closes',
			text: 'Escape closes the popup and keeps focus on the control.',
			gate: 'escape-closes',
		},
		{
			id: 'select.keep.shows-choice',
			text: 'Choosing an option commits it and dispatches change.',
			gate: 'shows-choice',
		},
		{
			id: 'select.keep.fits-narrow',
			text: 'Fits a narrow viewport without horizontal overflow or outer margin.',
			gate: 'fits-narrow',
		},
		{
			id: 'select.keep.short-list',
			text: 'Keep option labels concise (human/design review).',
		},
	],
	setups: {
		'three-options': {
			text: 'Mount a select labeled "Size" with Small, Medium, and Large options.',
			targets: {
				control: { role: 'combobox', name: 'Size' },
				medium: { role: 'option', name: 'Medium' },
			},
		},
		'one-chosen': {
			text: 'Mount a select labeled "Size" with three options and choose Medium.',
			targets: {
				control: { role: 'combobox', name: 'Size' },
				medium: { role: 'option', name: 'Medium' },
			},
		},
	},
	gates: {
		named: {
			setup: 'three-options',
			scenario: [
				{
					id: 'check-name',
					expect: { target: 'control', a11y: { role: 'combobox', name: 'Size', expanded: false } },
				},
			],
		},
		'escape-closes': {
			setup: 'three-options',
			scenario: [
				{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
				{ id: 'is-open', expect: { target: 'control', a11y: { expanded: true } } },
				{ id: 'esc', action: { press: 'Escape' } },
				{ id: 'closed', expect: { target: 'control', a11y: { expanded: false } } },
				{ id: 'back', expect: { target: 'control', focus: true } },
			],
		},
		'shows-choice': {
			setup: 'one-chosen',
			scenario: [
				{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
				{ id: 'next', action: { press: 'ArrowDown' } },
				{ id: 'commit', action: { press: 'Enter' } },
				{ id: 'changed', expect: { event: 'change', target: 'control', since: 'commit' } },
				{ id: 'selected', expect: { target: 'medium', a11y: { selected: true } } },
			],
		},
		'fits-narrow': {
			setup: 'three-options',
			context: { viewport: { width: 390, height: 844 } },
			scenario: [
				{
					id: 'narrow-layout',
					expect: {
						target: 'control',
						layout: { minHeight: 36, noOverflow: true, noOuterMargin: true },
					},
				},
			],
		},
	},
};

describe('Patterns B3: setups, filtered list, native gate execution, patterns@1, and stub upgrades', () => {
	let root: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-b3-')));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('satisfies Job 4, byte-identical schema-partitions@1/guides@1, filtered list + pagination, and PA-8 capture skip', async () => {
		const dir = join(root, 'job4');
		await mkdir(join(dir, 'specimens', 'patterns', 'select'), { recursive: true });
		await writeFile(
			join(dir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'select.js',
						declarations: [
							{
								kind: 'class',
								name: 'ExampleSelect',
								tagName: 'example-select',
								customElement: true,
								attributes: [{ name: 'open', type: { text: 'boolean' } }],
							},
						],
					},
				],
			})
		);
		await writeFile(
			join(dir, 'select.guide.json'),
			JSON.stringify({
				tag: 'example-select',
				summary: 'Choose one value.',
				status: 'stable',
				usage: [{ id: 'select.when', text: 'Use for short fixed lists.' }],
				implements: ['select'],
			})
		);
		await writeFile(
			join(dir, 'specimens.js'),
			`import ${selectFixture};
class BrokenDropdown extends HTMLElement {
	static observedAttributes = ['label', 'open'];
	#internals = this.attachInternals();
	constructor() {
		super();
		this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML =
			'<button type="button" part="trigger" tabindex="0">Size</button><div role="group"><slot></slot></div>';
		this.#internals.role = 'combobox';
		this.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown') {
				this.setAttribute('open', '');
			} else if (event.key === 'Escape') {
				this.removeAttribute('open');
				// Seeded bug: blurs control on Escape, dropping focus to the page.
				this.shadowRoot?.querySelector('button')?.blur();
			}
		});
	}
	connectedCallback() { this.#sync(); }
	attributeChangedCallback() { this.#sync(); }
	#sync() {
		this.#internals.ariaLabel = this.getAttribute('label');
		this.#internals.ariaExpanded = this.hasAttribute('open') ? 'true' : 'false';
	}
}
if (!customElements.get('example-dropdown')) customElements.define('example-dropdown', BrokenDropdown);

const markup = (html) => {
	const t = document.createElement('template');
	t.innerHTML = html;
	return t.content.firstElementChild;
};
export const SelectThreeOptions = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const SelectOneChosen = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const DropdownThreeOptions = {
	render: () => markup('<example-dropdown label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option></example-dropdown>'),
};
`
		);

		const baseConfig = {
			manifest: './manifest.json',
			guides: ['./select.guide.json'],
			pack: {
				library: 'example',
				title: 'Example',
				prefix: 'example-',
				directory: './pack',
				package: 'example-components',
			},
			specimens: [
				{
					id: 'example-select-three-options',
					title: 'Select / Three options',
					module: './specimens.js',
					exportName: 'SelectThreeOptions',
					component: 'example-select',
					patternSetup: { pattern: 'select', setup: 'three-options' },
				},
				{
					id: 'example-select-one-chosen',
					title: 'Select / One chosen',
					module: './specimens.js',
					exportName: 'SelectOneChosen',
					component: 'example-select',
					patternSetup: { pattern: 'select', setup: 'one-chosen' },
				},
				{
					id: 'example-dropdown-three-options',
					title: 'Dropdown / Three options',
					module: './specimens.js',
					exportName: 'DropdownThreeOptions',
					component: 'example-dropdown',
					patternSetup: { pattern: 'select', setup: 'three-options' },
				},
			],
		};

		// Baseline without pattern files: capture exact schema-partitions@1 + guides@1 output.
		const noPatternDir = join(root, 'job4-baseline');
		await mkdir(noPatternDir, { recursive: true });
		await writeFile(
			join(noPatternDir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'select.js',
						declarations: [
							{
								kind: 'class',
								name: 'ExampleSelect',
								tagName: 'example-select',
								customElement: true,
								attributes: [{ name: 'open', type: { text: 'boolean' } }],
							},
						],
					},
				],
			})
		);
		await writeFile(
			join(noPatternDir, 'select.guide.json'),
			JSON.stringify({
				tag: 'example-select',
				summary: 'Choose one value.',
				status: 'stable',
				usage: [{ id: 'select.when', text: 'Use for short fixed lists.' }],
			})
		);
		await writeFile(
			join(noPatternDir, 'specimens.js'),
			`import ${selectFixture};
const markup = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
export const SelectThreeOptions = { render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>') };
export const SelectOneChosen = { render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>') };
`
		);
		await writeFile(
			join(noPatternDir, 'specimen.config.json'),
			JSON.stringify({
				manifest: './manifest.json',
				guides: ['./select.guide.json'],
				specimens: baseConfig.specimens.slice(0, 2).map(({ patternSetup: _, ...rest }) => rest),
			})
		);
		await writeFile(
			join(dir, 'specimens', 'patterns', 'select', 'pattern.json'),
			JSON.stringify(SELECT_PATTERN, null, '\t')
		);
		await writeFile(join(dir, 'specimen.config.json'), JSON.stringify(baseConfig, null, '\t'));

		const baselineBench = await createSpecimenBench({ root: noPatternDir });
		const bench = await createSpecimenBench({ root: dir });
		try {
			expect(bench.validate().valid).toBe(true);

			// 1. Filtered list + cursor pagination + deterministic Job 4 first-result order.
			const gates = bench.list({ pattern: 'select', kind: 'gate' });
			expect(gates[0]?.id).toBe('example-select-three-options--gate--escape-closes');
			expect(
				gates.every((entry) => entry.kind === 'gate' && entry.pattern?.pattern === 'select')
			).toBe(true);
			const page1 = bench.list({ kind: 'gate', limit: 2 });
			expect(page1).toHaveLength(2);
			const page2 = bench.list({ kind: 'gate', limit: 2, after: page1[1]?.id });
			expect(page2).toHaveLength(2);
			expect(page2[0]?.id).not.toBe(page1[1]?.id);

			// 2. Single-id gate run passes with capture: 'none' (no observation flooded into context).
			const passRun = gateRunSchema.parse(
				await bench.run({
					id: 'example-select-three-options--gate--escape-closes',
					capture: 'none',
				})
			);
			expect(passRun.outcome).toEqual({ status: 'passed', failures: [] });
			expect(passRun.observation).toBeNull();

			// 3. Broken component fails naming the exact stepId ('back') and kind ('focus').
			const failNoCapture = gateRunSchema.parse(
				await bench.run({
					id: 'example-dropdown-three-options--gate--escape-closes',
					capture: 'none',
				})
			);
			expect(failNoCapture.outcome.status).toBe('failed');
			expect(failNoCapture.outcome.failures[0]).toMatchObject({ stepId: 'back', kind: 'focus' });
			expect(failNoCapture.observation).toBeNull();

			// Failure-time capture attaches an observation when capture: 'failed' is requested.
			const failWithCapture = gateRunSchema.parse(
				await bench.run({
					id: 'example-dropdown-three-options--gate--escape-closes',
					capture: 'failed',
				})
			);
			expect(failWithCapture.outcome.status).toBe('failed');
			expect(failWithCapture.observation).not.toBeNull();
			expect(failWithCapture.observation?.manifest.specimenId).toBe(
				'example-dropdown-three-options--gate--escape-closes'
			);

			// 4. Suite mode runs synthesized gates filtered by kind + pattern.
			const suite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: {
						kind: ['gate'],
						pattern: 'select',
						ids: [
							'example-select-three-options--gate--named',
							'example-select-three-options--gate--escape-closes',
							'example-select-one-chosen--gate--shows-choice',
						],
					},
					capture: 'none',
					workers: 2,
				})
			);
			expect(suite.outcome).toBe('passed');
			expect(suite.counts).toMatchObject({ total: 3, passed: 3, failed: 0, outOfContext: 0 });
			expect(suite.stories[0]?.file).toBe('specimens/patterns/select/pattern.json');
			expect(suite.stories[0]?.flakeId).toBe('example-select-three-options--gate--escape-closes');

			// 5. Coverage reports patterns@1 and keeps schema-partitions@1 & guides@1 byte-identical.
			const sharedCovRequest = {
				component: 'example-select',
				filter: { ids: ['example-select-three-options', 'example-select-one-chosen'] },
				workers: 1,
			};
			const baseCov = coverageRunSchema.parse(await baselineBench.coverage(sharedCovRequest));
			const withPatCov = coverageRunSchema.parse(await bench.coverage(sharedCovRequest));
			const stripForByteIdentity = ({
				elapsedMs: _elapsed,
				patterns: _patterns,
				...rest
			}: typeof withPatCov) => rest;
			expect(baseCov.patterns).toBeUndefined();
			expect(JSON.stringify(stripForByteIdentity(withPatCov))).toBe(
				JSON.stringify(stripForByteIdentity(baseCov))
			);
			expect(withPatCov.patterns).toMatchObject({
				obligations: 'patterns@1',
				complete: true,
				counts: { verified: 4, missing: 0, ungated: 1, 'out-of-context': 0 },
				implementations: [
					{
						patternLibrary: 'example',
						pattern: 'select',
						kind: 'component',
						tag: 'example-select',
						keep: [
							{ id: 'select.keep.named', level: 'verified' },
							{ id: 'select.keep.escape-closes', level: 'verified' },
							{ id: 'select.keep.shows-choice', level: 'verified' },
							{ id: 'select.keep.fits-narrow', level: 'verified' },
							{ id: 'select.keep.short-list', level: 'ungated' },
						],
					},
				],
			});

			// 6. PA-8: unfiltered specimen-capture skips synthesized gate cases, while explicit
			// selection by `ids` or `filter.kind: ['gate']` captures the gate observation cleanly.
			const captured = await bench.captureSet({ workers: 1, axe: false });
			expect(captured.skipped.gates).toBeGreaterThan(0);
			expect(captured.skipped.gatesNext).toBe('specimen-run');

			const capturedById = await bench.captureSet({
				ids: ['example-select-three-options--gate--escape-closes'],
				axe: true,
				workers: 1,
			});
			expect(capturedById.counts).toMatchObject({ captured: 1, unavailable: 0 });
			expect(capturedById.counts.axe.passed).toBe(1);
			expect(capturedById.skipped.gates).toBe(0);

			const capturedByKind = await bench.captureSet({
				filter: {
					kind: ['gate'],
					ids: ['example-select-three-options--gate--escape-closes'],
				},
				axe: false,
				workers: 1,
			});
			expect(capturedByKind.counts).toMatchObject({ captured: 1, unavailable: 0 });
			expect(capturedByKind.skipped.gates).toBe(0);
		} finally {
			await baselineBench.close();
			await bench.close();
		}
	}, 90_000);

	it('satisfies Jobs 3 and 9: external patternSources, missing setup + suggest stubs, out-of-context gates, and play-free story setups', async () => {
		// External owning library pack root (no network).
		const extPack = join(root, 'ext-pack');
		await mkdir(join(extPack, 'data', 'example', 'patterns'), { recursive: true });
		await writeFile(
			join(extPack, 'data', 'example', 'patterns', 'select.json'),
			JSON.stringify(SELECT_PATTERN, null, '\t')
		);

		const consumerDir = join(root, 'consumer');
		await mkdir(consumerDir, { recursive: true });
		await writeFile(
			join(consumerDir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'touch-select.js',
						declarations: [
							{
								kind: 'class',
								name: 'TouchSelect',
								tagName: 'touch-select',
								customElement: true,
								attributes: [{ name: 'label', type: { text: 'string' } }],
							},
							{
								kind: 'class',
								name: 'DeskSelect',
								tagName: 'desk-select',
								customElement: true,
								attributes: [{ name: 'label', type: { text: 'string' } }],
							},
						],
					},
				],
			})
		);
		await writeFile(
			join(consumerDir, 'touch-select.guide.json'),
			JSON.stringify({
				tag: 'touch-select',
				summary: 'Touch-friendly select.',
				status: 'preview',
				implements: [{ library: 'example', pattern: 'select' }],
			})
		);
		await writeFile(
			join(consumerDir, 'desk-select.guide.json'),
			JSON.stringify({
				tag: 'desk-select',
				summary: 'Desktop-only select.',
				status: 'stable',
				implements: [{ library: 'example', pattern: 'select' }],
				contexts: {
					viewport: { minWidth: 1024 },
					reason: 'Used only in the desktop console.',
				},
			})
		);
		await writeFile(
			join(consumerDir, 'specimens.js'),
			`import ${selectFixture};
const markup = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
export const TouchThreeOptions = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const DeskThreeOptions = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const DeskOneChosen = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const ConsumerRegion = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m">Medium</example-option></example-select>'),
};
`
		);
		// Play-free retained story serving as a pattern setup.
		await writeFile(
			join(consumerDir, 'select.stories.js'),
			`import ${selectFixture};
export default {
	title: 'Controls/StorySelect',
	component: 'story-select',
};
export const ThreeOptions = {
	render: () => {
		const el = document.createElement('example-select');
		el.setAttribute('label', 'Size');
		el.innerHTML = '<example-option value="s">Small</example-option><example-option value="m">Medium</example-option>';
		return el;
	},
	parameters: {
		specimen: {
			patternSetup: { library: 'example', pattern: 'select', setup: 'three-options' },
			contexts: {
				themes: ['light'],
				reason: 'Story fixture is light theme only.',
			},
		},
	},
};
`
		);
		await writeFile(
			join(consumerDir, 'specimen.config.json'),
			JSON.stringify(
				{
					manifest: './manifest.json',
					guides: ['./touch-select.guide.json', './desk-select.guide.json'],
					patternSources: [extPack],
					stories: ['./select.stories.js'],
					specimens: [
						{
							id: 'touch-select-three-options',
							title: 'Touch Select / Three options',
							module: './specimens.js',
							exportName: 'TouchThreeOptions',
							component: 'touch-select',
							patternSetup: { library: 'example', pattern: 'select', setup: 'three-options' },
						},
						{
							id: 'desk-select-three-options',
							title: 'Desk Select / Three options',
							module: './specimens.js',
							exportName: 'DeskThreeOptions',
							component: 'desk-select',
							patternSetup: { library: 'example', pattern: 'select', setup: 'three-options' },
						},
						{
							id: 'desk-select-one-chosen',
							title: 'Desk Select / One chosen',
							module: './specimens.js',
							exportName: 'DeskOneChosen',
							component: 'desk-select',
							patternSetup: { library: 'example', pattern: 'select', setup: 'one-chosen' },
						},
						{
							id: 'consumer-region-select',
							title: 'Consumer / Region Select',
							module: './specimens.js',
							exportName: 'ConsumerRegion',
							patternSetup: { library: 'example', pattern: 'select', setup: 'three-options' },
						},
					],
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root: consumerDir });
		try {
			expect(bench.validate().valid).toBe(true);

			// Job 3: external gate runs unchanged on touch-select.
			const touchRun = gateRunSchema.parse(
				await bench.run({ id: 'touch-select-three-options--gate--named', capture: 'none' })
			);
			expect(touchRun.outcome.status).toBe('passed');

			// Job 3: coverage flags missing setup for shows-choice (`one-chosen`).
			const touchCov = coverageRunSchema.parse(
				await bench.coverage({ component: 'touch-select', workers: 1 })
			);
			expect(touchCov.patterns).toMatchObject({
				obligations: 'patterns@1',
				complete: false,
				implementations: [
					{
						patternLibrary: 'example',
						pattern: 'select',
						tag: 'touch-select',
						keep: [
							{ id: 'select.keep.named', level: 'verified' },
							{ id: 'select.keep.escape-closes', level: 'verified' },
							{ id: 'select.keep.shows-choice', level: 'missing' },
							{ id: 'select.keep.fits-narrow', level: 'verified' },
							{ id: 'select.keep.short-list', level: 'ungated' },
						],
					},
				],
			});

			// Job 3: specimen-suggest emits placeholder setup stub (with component and tagless).
			const compSuggest = suggestRunSchema.parse(
				await bench.suggest({
					component: 'touch-select',
					gaps: ['pattern:example/select.keep.shows-choice'],
				})
			);
			expect(compSuggest.status).toBe('unverified');
			expect(compSuggest.entries).toHaveLength(1);
			expect(compSuggest.entries[0]?.patternSetup).toEqual({
				library: 'example',
				pattern: 'select',
				setup: 'one-chosen',
			});
			expect(compSuggest.suggestions[0]).toMatchObject({
				obligation: 'pattern:example/select.keep.shows-choice',
				placeholder: true,
			});

			const taglessSuggest = suggestRunSchema.parse(
				await bench.suggest({
					pattern: 'example/select',
					gaps: ['pattern:example/select.keep.shows-choice'],
				})
			);
			expect(taglessSuggest.component).toBeUndefined();
			expect(taglessSuggest.status).toBe('unverified');
			expect(taglessSuggest.entries).toHaveLength(1);
			expect(taglessSuggest.entries[0]?.component).toBeUndefined();
			expect(taglessSuggest.entries[0]?.patternSetup).toEqual({
				library: 'example',
				pattern: 'select',
				setup: 'one-chosen',
			});

			// Job 9: desktop-only component reports narrow gate as out-of-context (single-id, suite, coverage).
			const oocRun = gateRunSchema.parse(
				await bench.run({ id: 'desk-select-three-options--gate--fits-narrow', capture: 'none' })
			);
			expect(oocRun.outcome).toEqual({
				status: 'out-of-context',
				reason: 'Used only in the desktop console.',
				failures: [],
			});
			expect(oocRun.observation).toBeNull();

			const oocSuite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: { ids: ['desk-select-three-options--gate--fits-narrow'], kind: ['gate'] },
				})
			);
			expect(oocSuite.outcome).toBe('passed');
			expect(oocSuite.counts).toMatchObject({ total: 1, passed: 0, failed: 0, outOfContext: 1 });
			expect(oocSuite.stories[0]?.status).toBe('out-of-context');

			const deskCov = coverageRunSchema.parse(
				await bench.coverage({ component: 'desk-select', workers: 1 })
			);
			expect(deskCov.patterns).toMatchObject({
				complete: true,
				counts: { verified: 3, missing: 0, ungated: 1, 'out-of-context': 1 },
				implementations: [
					{
						patternLibrary: 'example',
						pattern: 'select',
						tag: 'desk-select',
						keep: [
							{ id: 'select.keep.named', level: 'verified' },
							{ id: 'select.keep.escape-closes', level: 'verified' },
							{ id: 'select.keep.shows-choice', level: 'verified' },
							{
								id: 'select.keep.fits-narrow',
								level: 'out-of-context',
								reason: 'Used only in the desktop console.',
							},
							{ id: 'select.keep.short-list', level: 'ungated' },
						],
					},
				],
			});

			// Play-free retained story synthesizes gate cases and runs cleanly (plus respects story contexts).
			const storyGateId = 'controls-storyselect--three-options--gate--named';
			expect(
				bench.list({ kind: 'gate', match: 'controls-storyselect' }).map((e) => e.id)
			).toContain(storyGateId);
			const storyGatePass = gateRunSchema.parse(
				await bench.run({ id: storyGateId, capture: 'none' })
			);
			expect(storyGatePass.outcome.status).toBe('passed');
			const storyGateOoc = gateRunSchema.parse(
				await bench.run({ id: storyGateId, context: { theme: 'dark' }, capture: 'none' })
			);
			expect(storyGateOoc.outcome).toEqual({
				status: 'out-of-context',
				reason: 'Story fixture is light theme only.',
				failures: [],
			});

			// Tagless consumer setup produces `kind: 'case'` coverage.
			const allPatternCov = coverageRunSchema.parse(
				await bench.coverage({ pattern: 'example/select', workers: 1 })
			);
			const regionImpl = allPatternCov.patterns?.implementations.find(
				(impl) => impl.kind === 'case' && impl.case === 'consumer-region-select'
			);
			expect(regionImpl).toBeDefined();
			expect(regionImpl?.keep.find((k) => k.id === 'select.keep.named')?.level).toBe('verified');
		} finally {
			await bench.close();
		}
	}, 90_000);

	it('passes all 8 baseline portable gates unchanged across two divergent select/field pairs and catches all 5 seeded faults each (P0-4)', async () => {
		const dir = join(root, 'p0-4');
		await mkdir(join(dir, 'specimens', 'patterns', 'select'), { recursive: true });
		await mkdir(join(dir, 'specimens', 'patterns', 'field'), { recursive: true });

		// Shared portable role sets + prefix name matchers (matching Phase 0 P0-1/P0-4):
		// works unchanged across both `example-select` (combobox named "Size") and `alt-select`
		// (Violet-style shadow button trigger whose accessible name includes the chosen label).
		const selectFullPattern: PatternFile = {
			pattern: 'select',
			summary: 'Full 8-gate select contract.',
			status: 'stable',
			scope: 'control',
			setups: {
				default: {
					text: 'Select labeled Size with Small, Medium (disabled), and Large options.',
					targets: {
						control: { role: ['combobox', 'button'], nameStartsWith: 'Size' },
						large: { role: 'option', name: 'Large' },
					},
				},
				disabled: {
					text: 'Disabled select labeled Size.',
					targets: { control: { role: ['combobox', 'button'], nameStartsWith: 'Size' } },
				},
				form: {
					text: 'Required select named size inside a form.',
					targets: { control: { role: ['combobox', 'button'], nameStartsWith: 'Size' } },
				},
			},
			gates: {
				'g1-named': {
					setup: 'default',
					scenario: [
						{
							id: 'named',
							expect: {
								target: 'control',
								a11y: { role: ['combobox', 'button'], nameContains: 'Size', expanded: false },
							},
						},
					],
				},
				'g2-opens': {
					setup: 'default',
					scenario: [
						{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
						{ id: 'expanded', expect: { target: 'control', a11y: { expanded: true } } },
					],
				},
				'g3-skips-disabled': {
					setup: 'default',
					scenario: [
						{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
						{ id: 'skip', action: { press: 'ArrowDown' } },
						{ id: 'commit', action: { press: 'Enter' } },
						{ id: 'chose-large', expect: { target: 'large', a11y: { selected: true } } },
					],
				},
				'g4-commit-events': {
					setup: 'default',
					scenario: [
						{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
						{ id: 'pick', action: { press: 'End' } },
						{ id: 'commit', action: { press: 'Enter' } },
						{ id: 'input-fired', expect: { event: 'input', target: 'control', since: 'commit' } },
						{ id: 'change-fired', expect: { event: 'change', target: 'control', since: 'commit' } },
						{ id: 'closed', expect: { target: 'control', a11y: { expanded: false } } },
					],
				},
				'g5-escape': {
					setup: 'default',
					scenario: [
						{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
						{ id: 'esc', action: { press: 'Escape' } },
						{ id: 'closed', expect: { target: 'control', a11y: { expanded: false } } },
						{ id: 'focused', expect: { target: 'control', focus: true } },
					],
				},
				'g6-disabled': {
					setup: 'disabled',
					scenario: [
						{
							id: 'is-disabled',
							expect: { target: 'control', a11y: { disabled: true, expanded: false } },
						},
					],
				},
				'g7-form-validity': {
					setup: 'form',
					scenario: [
						{ id: 'initially-invalid', expect: { target: 'control', validity: { valid: false } } },
						{ id: 'open', action: { press: 'ArrowDown', target: 'control' } },
						{ id: 'commit', action: { press: 'Enter' } },
						{ id: 'now-valid', expect: { target: 'control', validity: { valid: true } } },
						{ id: 'in-form', expect: { target: 'control', form: { name: 'size', value: 's' } } },
					],
				},
				'g8-layout': {
					setup: 'default',
					context: { viewport: { width: 375, height: 812 } },
					scenario: [
						{
							id: 'layout-ok',
							expect: {
								target: 'control',
								layout: { minHeight: 36, noOverflow: true, noOuterMargin: true },
							},
						},
					],
				},
			},
		};

		const fieldFullPattern: PatternFile = {
			pattern: 'field',
			summary: 'Full 8-gate text field contract.',
			status: 'stable',
			scope: 'control',
			setups: {
				default: {
					text: 'Editable text field labeled Email.',
					targets: { control: { role: ['textbox', 'searchbox'], nameStartsWith: 'Email' } },
				},
				disabled: {
					text: 'Disabled text field labeled Email.',
					targets: { control: { role: ['textbox', 'searchbox'], nameStartsWith: 'Email' } },
				},
				invalid: {
					text: 'Invalid text field labeled Email.',
					targets: { control: { role: ['textbox', 'searchbox'], nameStartsWith: 'Email' } },
				},
				form: {
					text: 'Required text field named email inside a form.',
					targets: { control: { role: ['textbox', 'searchbox'], nameStartsWith: 'Email' } },
				},
			},
			gates: {
				'g1-named': {
					setup: 'default',
					scenario: [
						{
							id: 'named',
							expect: {
								target: 'control',
								a11y: { role: ['textbox', 'searchbox'], nameContains: 'Email' },
							},
						},
					],
				},
				'g2-focus': {
					setup: 'default',
					scenario: [
						{ id: 'focus', action: { focus: 'control' } },
						{ id: 'focused', expect: { target: 'control', focus: true } },
					],
				},
				'g3-fill-events': {
					setup: 'default',
					scenario: [
						{ id: 'type', action: { fill: 'control', value: 'ada@example.com' } },
						{ id: 'input-fired', expect: { event: 'input', target: 'control', since: 'type' } },
						{ id: 'change-fired', expect: { event: 'change', target: 'control', since: 'type' } },
					],
				},
				'g4-disabled': {
					setup: 'disabled',
					scenario: [
						{ id: 'is-disabled', expect: { target: 'control', a11y: { disabled: true } } },
					],
				},
				'g5-invalid': {
					setup: 'invalid',
					scenario: [{ id: 'is-invalid', expect: { target: 'control', a11y: { invalid: true } } }],
				},
				'g6-required-validity': {
					setup: 'form',
					scenario: [
						{ id: 'req-state', expect: { target: 'control', a11y: { required: true } } },
						{ id: 'invalid-empty', expect: { target: 'control', validity: { valid: false } } },
						{ id: 'fill', action: { fill: 'control', value: 'ada@example.com' } },
						{ id: 'valid-filled', expect: { target: 'control', validity: { valid: true } } },
					],
				},
				'g7-form-data': {
					setup: 'form',
					scenario: [
						{ id: 'fill', action: { fill: 'control', value: 'grace@example.com' } },
						{
							id: 'submitted',
							expect: { target: 'control', form: { name: 'email', value: 'grace@example.com' } },
						},
					],
				},
				'g8-layout': {
					setup: 'default',
					context: { viewport: { width: 375, height: 812 } },
					scenario: [
						{
							id: 'layout-ok',
							expect: {
								target: 'control',
								layout: { minHeight: 36, noOverflow: true, noOuterMargin: true },
							},
						},
					],
				},
			},
		};

		await writeFile(
			join(dir, 'specimens', 'patterns', 'select', 'pattern.json'),
			JSON.stringify(selectFullPattern, null, '\t')
		);
		await writeFile(
			join(dir, 'specimens', 'patterns', 'field', 'pattern.json'),
			JSON.stringify(fieldFullPattern, null, '\t')
		);
		await writeFile(
			join(dir, 'specimens.js'),
			`import ${selectFixture};
import ${fieldFixture};
const markup = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };

export const SelectDefault = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="m" disabled>Medium</example-option><example-option value="l">Large</example-option></example-select>'),
};
export const SelectDisabled = {
	render: () => markup('<example-select label="Size" disabled><example-option value="s">Small</example-option></example-select>'),
};
export const SelectForm = {
	render: () => markup('<form><example-select label="Size" name="size" required><example-option value="s">Small</example-option><example-option value="l">Large</example-option></example-select></form>'),
};
export const FieldDefault = {
	render: () => markup('<example-field label="Email"></example-field>'),
};
export const FieldDisabled = {
	render: () => markup('<example-field label="Email" disabled></example-field>'),
};
export const FieldInvalid = {
	render: () => markup('<example-field label="Email" invalid></example-field>'),
};
export const FieldForm = {
	render: () => markup('<form><example-field label="Email" name="email" required></example-field></form>'),
};

// Second divergent implementation pair (Violet-style DOM/ARIA: button trigger whose accessible
// name includes the chosen label, and inner 19px searchbox input inside a 36px shadow wrapper).
class AltSelect extends HTMLElement {
	static formAssociated = true;
	#internals = this.attachInternals();
	#open = false;
	#value = '';
	#active = -1;
	constructor() {
		super();
		const shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
		shadow.innerHTML = '<style>:host{display:block;min-height:36px;margin:0;box-sizing:border-box}button{min-height:36px;width:100%;text-align:left}</style><button type="button" aria-haspopup="listbox" aria-expanded="false"></button><div role="listbox"><slot></slot></div>';
		this.addEventListener('keydown', (e) => {
			if (this.hasAttribute('disabled')) return;
			const opts = [...this.querySelectorAll('[role=option]')];
			const enabled = opts.map((o, i) => (o.getAttribute('aria-disabled') === 'true' ? -1 : i)).filter((i) => i >= 0);
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				if (!this.#open) { this.#open = true; this.#active = enabled[0] ?? -1; }
				else { const p = enabled.indexOf(this.#active); this.#active = enabled[Math.min(enabled.length - 1, p + 1)] ?? this.#active; }
				this.#sync();
			} else if (e.key === 'End') {
				e.preventDefault();
				this.#open = true;
				this.#active = enabled.at(-1) ?? -1;
				this.#sync();
			} else if (e.key === 'Enter' && this.#open && this.#active >= 0) {
				e.preventDefault();
				this.#value = opts[this.#active]?.getAttribute('data-value') ?? '';
				this.#open = false;
				this.#sync();
				this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
				this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
			} else if (e.key === 'Escape' && this.#open) {
				e.preventDefault();
				this.#open = false;
				this.#sync();
				this.shadowRoot.querySelector('button').focus();
			}
		});
	}
	connectedCallback() { this.#sync(); }
	checkValidity() { return this.#internals.checkValidity(); }
	#sync() {
		const btn = this.shadowRoot.querySelector('button');
		const opts = [...this.querySelectorAll('[role=option]')];
		const chosen = opts.find((o) => o.getAttribute('data-value') === this.#value);
		const label = this.getAttribute('label') ?? '';
		btn.textContent = chosen ? label + ' ' + chosen.textContent : label + ' Select an option';
		btn.disabled = this.hasAttribute('disabled');
		btn.setAttribute('aria-expanded', String(this.#open));
		for (const o of opts) o.setAttribute('aria-selected', String(o === chosen));
		this.#internals.setFormValue(this.#value || null);
		if (this.hasAttribute('required') && !this.#value) this.#internals.setValidity({ valueMissing: true }, 'Required', btn);
		else this.#internals.setValidity({});
	}
}
if (!customElements.get('alt-select')) customElements.define('alt-select', AltSelect);

class AltField extends HTMLElement {
	static formAssociated = true;
	#internals = this.attachInternals();
	constructor() {
		super();
		const shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
		shadow.innerHTML = '<style>:host{display:block;min-height:36px;margin:0;box-sizing:border-box}.frame{display:flex;align-items:center;min-height:36px}input{height:19px;width:100%;border:0;margin:0;padding:0}</style><div class="frame"><input type="text" /></div>';
		const input = shadow.querySelector('input');
		input.addEventListener('input', () => {
			this.#sync();
			this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
		});
	}
	connectedCallback() { this.#sync(); }
	checkValidity() { return this.#internals.checkValidity(); }
	#sync() {
		const input = this.shadowRoot.querySelector('input');
		input.setAttribute('aria-label', this.getAttribute('label') ?? '');
		input.disabled = this.hasAttribute('disabled');
		input.required = this.hasAttribute('required');
		if (input.required) input.setAttribute('aria-required', 'true');
		else input.removeAttribute('aria-required');
		if (this.hasAttribute('invalid')) input.setAttribute('aria-invalid', 'true');
		else input.removeAttribute('aria-invalid');
		this.#internals.setFormValue(input.value);
		if (input.required && !input.value) this.#internals.setValidity({ valueMissing: true }, 'Required', input);
		else this.#internals.setValidity({});
	}
}
if (!customElements.get('alt-field')) customElements.define('alt-field', AltField);

export const AltSelectDefault = {
	render: () => markup('<alt-select label="Size"><div role="option" data-value="s">Small</div><div role="option" data-value="m" aria-disabled="true">Medium</div><div role="option" data-value="l">Large</div></alt-select>'),
};
export const AltSelectDisabled = {
	render: () => markup('<alt-select label="Size" disabled><div role="option" data-value="s">Small</div></alt-select>'),
};
export const AltSelectForm = {
	render: () => markup('<form><alt-select label="Size" name="size" required><div role="option" data-value="s">Small</div><div role="option" data-value="l">Large</div></alt-select></form>'),
};
export const AltFieldDefault = {
	render: () => markup('<alt-field label="Email"></alt-field>'),
};
export const AltFieldDisabled = {
	render: () => markup('<alt-field label="Email" disabled></alt-field>'),
};
export const AltFieldInvalid = {
	render: () => markup('<alt-field label="Email" invalid></alt-field>'),
};
export const AltFieldForm = {
	render: () => markup('<form><alt-field label="Email" name="email" required></alt-field></form>'),
};

// 5 seeded faults for select + 5 seeded faults for field.
export const FaultSelectNoLabel = {
	render: () => markup('<example-select><example-option value="s">Small</example-option></example-select>'),
};
export const FaultSelectNoEscape = {
	render: () => {
		const el = markup('<example-select label="Size"><example-option value="s">Small</example-option><example-option value="l">Large</example-option></example-select>');
		el.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopImmediatePropagation(); }, true);
		return el;
	},
};
export const FaultSelectMargin = {
	render: () => {
		const el = markup('<example-select label="Size"><example-option value="s">Small</example-option></example-select>');
		el.style.marginTop = '12px';
		return el;
	},
};
export const FaultSelectNotDisabled = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option></example-select>'),
};
export const FaultSelectNotRequired = {
	render: () => markup('<form><example-select label="Size" name="size"><example-option value="s">Small</example-option></example-select></form>'),
};
export const FaultFieldNoLabel = {
	render: () => markup('<example-field></example-field>'),
};
export const FaultFieldReadonly = {
	render: () => markup('<example-field label="Email" readonly></example-field>'),
};
export const FaultFieldNotInvalid = {
	render: () => markup('<example-field label="Email"></example-field>'),
};
export const FaultFieldNotRequired = {
	render: () => markup('<form><example-field label="Email" name="email"></example-field></form>'),
};
export const FaultFieldMargin = {
	render: () => {
		const el = markup('<example-field label="Email"></example-field>');
		el.style.marginLeft = '8px';
		return el;
	},
};
`
		);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify(
				{
					specimens: [
						{
							id: 'sel-default',
							title: 'S/Default',
							module: './specimens.js',
							exportName: 'SelectDefault',
							component: 'example-select',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'sel-disabled',
							title: 'S/Disabled',
							module: './specimens.js',
							exportName: 'SelectDisabled',
							component: 'example-select',
							patternSetup: { pattern: 'select', setup: 'disabled' },
						},
						{
							id: 'sel-form',
							title: 'S/Form',
							module: './specimens.js',
							exportName: 'SelectForm',
							component: 'example-select',
							patternSetup: { pattern: 'select', setup: 'form' },
						},
						{
							id: 'fld-default',
							title: 'F/Default',
							module: './specimens.js',
							exportName: 'FieldDefault',
							component: 'example-field',
							patternSetup: { pattern: 'field', setup: 'default' },
						},
						{
							id: 'fld-disabled',
							title: 'F/Disabled',
							module: './specimens.js',
							exportName: 'FieldDisabled',
							component: 'example-field',
							patternSetup: { pattern: 'field', setup: 'disabled' },
						},
						{
							id: 'fld-invalid',
							title: 'F/Invalid',
							module: './specimens.js',
							exportName: 'FieldInvalid',
							component: 'example-field',
							patternSetup: { pattern: 'field', setup: 'invalid' },
						},
						{
							id: 'fld-form',
							title: 'F/Form',
							module: './specimens.js',
							exportName: 'FieldForm',
							component: 'example-field',
							patternSetup: { pattern: 'field', setup: 'form' },
						},
						{
							id: 'alt-sel-default',
							title: 'AS/Default',
							module: './specimens.js',
							exportName: 'AltSelectDefault',
							component: 'alt-select',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'alt-sel-disabled',
							title: 'AS/Disabled',
							module: './specimens.js',
							exportName: 'AltSelectDisabled',
							component: 'alt-select',
							patternSetup: { pattern: 'select', setup: 'disabled' },
						},
						{
							id: 'alt-sel-form',
							title: 'AS/Form',
							module: './specimens.js',
							exportName: 'AltSelectForm',
							component: 'alt-select',
							patternSetup: { pattern: 'select', setup: 'form' },
						},
						{
							id: 'alt-fld-default',
							title: 'AF/Default',
							module: './specimens.js',
							exportName: 'AltFieldDefault',
							component: 'alt-field',
							patternSetup: { pattern: 'field', setup: 'default' },
						},
						{
							id: 'alt-fld-disabled',
							title: 'AF/Disabled',
							module: './specimens.js',
							exportName: 'AltFieldDisabled',
							component: 'alt-field',
							patternSetup: { pattern: 'field', setup: 'disabled' },
						},
						{
							id: 'alt-fld-invalid',
							title: 'AF/Invalid',
							module: './specimens.js',
							exportName: 'AltFieldInvalid',
							component: 'alt-field',
							patternSetup: { pattern: 'field', setup: 'invalid' },
						},
						{
							id: 'alt-fld-form',
							title: 'AF/Form',
							module: './specimens.js',
							exportName: 'AltFieldForm',
							component: 'alt-field',
							patternSetup: { pattern: 'field', setup: 'form' },
						},
						{
							id: 'fault-sel-nolabel',
							title: 'FS/NoLabel',
							module: './specimens.js',
							exportName: 'FaultSelectNoLabel',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'fault-sel-noesc',
							title: 'FS/NoEsc',
							module: './specimens.js',
							exportName: 'FaultSelectNoEscape',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'fault-sel-margin',
							title: 'FS/Margin',
							module: './specimens.js',
							exportName: 'FaultSelectMargin',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'fault-sel-nodis',
							title: 'FS/NoDis',
							module: './specimens.js',
							exportName: 'FaultSelectNotDisabled',
							patternSetup: { pattern: 'select', setup: 'disabled' },
						},
						{
							id: 'fault-sel-noreq',
							title: 'FS/NoReq',
							module: './specimens.js',
							exportName: 'FaultSelectNotRequired',
							patternSetup: { pattern: 'select', setup: 'form' },
						},
						{
							id: 'fault-fld-nolabel',
							title: 'FF/NoLabel',
							module: './specimens.js',
							exportName: 'FaultFieldNoLabel',
							patternSetup: { pattern: 'field', setup: 'default' },
						},
						{
							id: 'fault-fld-ro',
							title: 'FF/Readonly',
							module: './specimens.js',
							exportName: 'FaultFieldReadonly',
							patternSetup: { pattern: 'field', setup: 'default' },
						},
						{
							id: 'fault-fld-noinv',
							title: 'FF/NoInv',
							module: './specimens.js',
							exportName: 'FaultFieldNotInvalid',
							patternSetup: { pattern: 'field', setup: 'invalid' },
						},
						{
							id: 'fault-fld-noreq',
							title: 'FF/NoReq',
							module: './specimens.js',
							exportName: 'FaultFieldNotRequired',
							patternSetup: { pattern: 'field', setup: 'form' },
						},
						{
							id: 'fault-fld-margin',
							title: 'FF/Margin',
							module: './specimens.js',
							exportName: 'FaultFieldMargin',
							patternSetup: { pattern: 'field', setup: 'default' },
						},
					],
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			const baselineIds = [
				'sel-default--gate--g1-named',
				'sel-default--gate--g2-opens',
				'sel-default--gate--g3-skips-disabled',
				'sel-default--gate--g4-commit-events',
				'sel-default--gate--g5-escape',
				'sel-disabled--gate--g6-disabled',
				'sel-form--gate--g7-form-validity',
				'sel-default--gate--g8-layout',
				'fld-default--gate--g1-named',
				'fld-default--gate--g2-focus',
				'fld-default--gate--g3-fill-events',
				'fld-disabled--gate--g4-disabled',
				'fld-invalid--gate--g5-invalid',
				'fld-form--gate--g6-required-validity',
				'fld-form--gate--g7-form-data',
				'fld-default--gate--g8-layout',
				'alt-sel-default--gate--g1-named',
				'alt-sel-default--gate--g2-opens',
				'alt-sel-default--gate--g3-skips-disabled',
				'alt-sel-default--gate--g4-commit-events',
				'alt-sel-default--gate--g5-escape',
				'alt-sel-disabled--gate--g6-disabled',
				'alt-sel-form--gate--g7-form-validity',
				'alt-sel-default--gate--g8-layout',
				'alt-fld-default--gate--g1-named',
				'alt-fld-default--gate--g2-focus',
				'alt-fld-default--gate--g3-fill-events',
				'alt-fld-disabled--gate--g4-disabled',
				'alt-fld-invalid--gate--g5-invalid',
				'alt-fld-form--gate--g6-required-validity',
				'alt-fld-form--gate--g7-form-data',
				'alt-fld-default--gate--g8-layout',
			];
			const baselineSuite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: { ids: baselineIds, kind: ['gate'] },
					capture: 'none',
					workers: 2,
				})
			);
			const failedBaseline = baselineSuite.stories.filter((s) => s.status !== 'passed');
			expect(failedBaseline, JSON.stringify(failedBaseline, null, 2)).toEqual([]);
			expect(baselineSuite.counts).toMatchObject({ total: 32, passed: 32, failed: 0 });

			const expectedFaults: [string, string][] = [
				['fault-sel-nolabel--gate--g1-named', 'named'],
				['fault-sel-noesc--gate--g5-escape', 'closed'],
				['fault-sel-margin--gate--g8-layout', 'layout-ok'],
				['fault-sel-nodis--gate--g6-disabled', 'is-disabled'],
				['fault-sel-noreq--gate--g7-form-validity', 'initially-invalid'],
				['fault-fld-nolabel--gate--g1-named', 'named'],
				['fault-fld-ro--gate--g3-fill-events', 'type'],
				['fault-fld-noinv--gate--g5-invalid', 'is-invalid'],
				['fault-fld-noreq--gate--g6-required-validity', 'req-state'],
				['fault-fld-margin--gate--g8-layout', 'layout-ok'],
			];
			const faultSuite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: { ids: expectedFaults.map(([id]) => id), kind: ['gate'] },
					capture: 'none',
					workers: 2,
				})
			);
			expect(faultSuite.counts).toMatchObject({ total: 10, passed: 0, failed: 10 });
			for (const [id, expectedStep] of expectedFaults) {
				const story = faultSuite.stories.find((s) => s.id === id);
				const outcome = story?.attempts[0] as GateRun['outcome'] | undefined;
				expect(outcome?.status, id).toBe('failed');
				expect(outcome?.failures[0]?.stepId, id).toBe(expectedStep);
			}
		} finally {
			await bench.close();
		}
	}, 90_000);
});
