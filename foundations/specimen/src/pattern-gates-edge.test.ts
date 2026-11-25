import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { coverageRunSchema, gateRunSchema, suiteRunSchema } from './schema.js';
import type { PatternFile } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const packLibraryDir = resolve(here, '../fixtures/pack-library');
const selectFixture = JSON.stringify(join(packLibraryDir, 'select.js'));

const SIMPLE_PATTERN: PatternFile = {
	pattern: 'select',
	summary: 'Choose one value.',
	status: 'stable',
	scope: 'control',
	setups: {
		default: {
			text: 'Select labeled Size.',
			targets: {
				control: { role: 'combobox', name: 'Size' },
				missing: { role: 'button', name: 'DoesNotExist' },
			},
		},
	},
	keep: [{ id: 'select.keep.named', text: 'Has accessible name.', gate: 'named' }],
	gates: {
		named: {
			setup: 'default',
			scenario: [{ id: 'check-name', expect: { target: 'control', a11y: { name: 'Size' } } }],
		},
		'absent-missing': {
			setup: 'default',
			scenario: [
				{ id: 'noop', action: { focus: 'control' } },
				{
					id: 'expect-no-change',
					expect: { event: 'change', target: 'missing', since: 'noop', absent: true },
				},
			],
		},
		'click-disabled': {
			setup: 'default',
			scenario: [{ id: 'click-control', action: { click: 'control' } }],
		},
	},
};

describe('pattern gate edge cases and review regressions (#2146)', () => {
	let root: string;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'specimen-pattern-edge-'));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('covers native module bindings, sibling setup context isolation, external pack paths, absent event target errors, action timeout classification, and suggest safety', async () => {
		// External sibling pack outside bench root with same keep id as local pattern.
		const extPack = join(root, 'ext-pack');
		await mkdir(join(extPack, 'data', 'extlib', 'patterns'), { recursive: true });
		await writeFile(
			join(extPack, 'data', 'extlib', 'patterns', 'select.json'),
			JSON.stringify(
				{
					...SIMPLE_PATTERN,
					setups: {
						default: {
							text: "Adversarial prose */ throw new Error('pwned'); /* end",
							targets: {
								control: { role: 'combobox', name: 'Size' },
							},
						},
					},
					gates: {
						named: SIMPLE_PATTERN.gates?.named,
					},
				},
				null,
				'\t'
			)
		);

		const dir = join(root, 'bench');
		await mkdir(join(dir, 'specimens', 'patterns', 'select'), { recursive: true });
		await writeFile(
			join(dir, 'specimens', 'patterns', 'select', 'pattern.json'),
			JSON.stringify(SIMPLE_PATTERN, null, '\t')
		);
		await writeFile(
			join(dir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						kind: 'javascript-module',
						path: 'select.js',
						declarations: [
							{ kind: 'class', name: 'S', tagName: 'example-select', customElement: true },
						],
					},
				],
			})
		);
		await writeFile(
			join(dir, 'specimens.js'),
			`import ${selectFixture};
const markup = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
// Binding declared ONLY in native SpecimenDefinition (not in specimen.config.json).
export const NativeDefOnly = {
	patternSetup: { pattern: 'select', setup: 'default' },
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option></example-select>'),
};
// Unrestricted failing setup (wrong label) paired with a dark-only sibling setup.
export const BrokenUnrestricted = {
	render: () => markup('<example-select label="Wrong"><example-option value="s">Small</example-option></example-select>'),
};
export const DarkOnlySibling = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option></example-select>'),
};
export const DisabledSelect = {
	render: () => markup('<example-select label="Size" disabled><example-option value="s">Small</example-option></example-select>'),
};
export const ExtBound = {
	render: () => markup('<example-select label="Size"><example-option value="s">Small</example-option></example-select>'),
};
`
		);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify(
				{
					manifest: './manifest.json',
					pack: {
						library: 'local-lib',
						title: 'Local Library',
						prefix: 'example-',
						directory: './pack',
						package: '@example/local-lib',
					},
					patternSources: ['../ext-pack'],
					specimens: [
						{
							id: 'native-def-only',
							title: 'Native/DefOnly',
							module: './specimens.js',
							exportName: 'NativeDefOnly',
						},
						{
							id: 'broken-unrestricted',
							title: 'Iso/Broken',
							module: './specimens.js',
							exportName: 'BrokenUnrestricted',
							component: 'example-select',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'dark-only-sibling',
							title: 'Iso/DarkOnly',
							module: './specimens.js',
							exportName: 'DarkOnlySibling',
							component: 'example-select',
							patternSetup: { pattern: 'select', setup: 'default' },
							contexts: { themes: ['dark'], reason: 'Dark-only variant' },
						},
						{
							id: 'disabled-select',
							title: 'Timeout/Disabled',
							module: './specimens.js',
							exportName: 'DisabledSelect',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: 'ext-bound',
							title: 'Ext/Bound',
							module: './specimens.js',
							exportName: 'ExtBound',
							patternSetup: { library: 'extlib', pattern: 'select', setup: 'default' },
						},
					],
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			expect(bench.validate().issues).toEqual([]);
			expect(bench.validate().valid).toBe(true);

			// 1. Native SpecimenDefinition-only binding synthesized and runs cleanly.
			const nativeDefGates = bench.list({ kind: 'gate', match: 'native-def-only' });
			expect(nativeDefGates.map((g) => g.id)).toContain('native-def-only--gate--named');
			const nativePass = gateRunSchema.parse(
				await bench.run({ id: 'native-def-only--gate--named', capture: 'none' })
			);
			expect(nativePass.outcome.status).toBe('passed');

			// 2. Sibling dark-only setup cannot mask a failing unrestricted setup in patterns@1 coverage.
			const cov = coverageRunSchema.parse(
				await bench.coverage({ component: 'example-select', workers: 1 })
			);
			expect(cov.patterns?.complete).toBe(false);
			const selectImpl = cov.patterns?.implementations.find(
				(i) => i.kind === 'component' && i.tag === 'example-select'
			);
			expect(selectImpl?.keep[0]).toEqual({ id: 'select.keep.named', level: 'missing' });

			// 3. External pack outside bench root keeps real root-relative path and matches `filter.file`.
			const extFile = '../ext-pack/data/extlib/patterns/select.json';
			const extSuite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: { kind: ['gate'], file: extFile },
					capture: 'none',
					workers: 1,
				})
			);
			expect(extSuite.counts).toMatchObject({ total: 1, passed: 1 });
			expect(extSuite.stories[0]?.file).toBe(extFile);

			// 4. `absent: true` event expectation fails with TARGET_NOT_FOUND when target does not exist.
			const absentFail = gateRunSchema.parse(
				await bench.run({ id: 'native-def-only--gate--absent-missing', capture: 'none' })
			);
			expect(absentFail.outcome.status).toBe('failed');
			expect(absentFail.outcome.failures[0]).toMatchObject({
				stepId: 'expect-no-change',
				kind: 'target',
				code: 'TARGET_NOT_FOUND',
			});

			// 5. Timed-out action on a disabled control reports real stepId/kind AND captures observation.
			const timedOut = gateRunSchema.parse(
				await bench.run({
					id: 'disabled-select--gate--click-disabled',
					capture: 'failed',
					timeoutMs: 1800,
				})
			);
			expect(timedOut.outcome.status).toBe('failed');
			expect(timedOut.outcome.failures[0]).toMatchObject({
				stepId: 'click-control',
				kind: 'action',
			});
			expect(timedOut.observation).not.toBeNull();

			// 6. Unqualified `pattern:<id>` resolves in local library even when external library has same id;
			//    external adversarial setup prose never breaks out of comments in generated source.
			const localSuggest = await bench.suggest({
				pattern: 'select',
				gaps: ['pattern:select.keep.named'],
			});
			expect(localSuggest.entries).toHaveLength(1);
			expect(localSuggest.skipped).toHaveLength(0);
			expect(localSuggest.entries[0]?.patternSetup).toEqual({
				pattern: 'select',
				setup: 'default',
			});

			const extSuggest = await bench.suggest({
				pattern: 'extlib/select',
				gaps: ['pattern:extlib/select.keep.named'],
			});
			expect(extSuggest.entries).toHaveLength(1);
			// The adversarial `*/ throw new Error('pwned'); /*` only appears inside a JSON string literal,
			// never outside a string as raw comment text.
			expect(extSuggest.source).not.toMatch(/\/\*\*[\s\S]*pwned[\s\S]*\*\//);
			expect(extSuggest.source).toContain(
				JSON.stringify(
					"REPLACE_WITH_WHAT_THIS_SHOULD_BE: mount setup 'default' (Adversarial prose */ throw new Error('pwned'); /* end)"
				)
			);
		} finally {
			await bench.close();
		}
	}, 90_000);

	it('rejects uppercase/oversize gate ids and unknown-play stories, forwards localLibrary to story filters, and keeps gate theme authoritative on retained stories', async () => {
		const dir = join(root, 'stories-edge');
		await mkdir(join(dir, 'specimens', 'patterns', 'select'), { recursive: true });
		await writeFile(
			join(dir, 'specimens', 'patterns', 'select', 'pattern.json'),
			JSON.stringify(
				{
					pattern: 'select',
					summary: 'Theme-checked select.',
					status: 'stable',
					scope: 'control',
					setups: {
						default: {
							text: 'Select labeled Size.',
							targets: { control: { role: 'combobox', name: 'Size' } },
						},
					},
					gates: {
						'light-theme': {
							setup: 'default',
							context: { theme: 'light' },
							scenario: [
								{
									id: 'check-theme',
									expect: { target: 'control', a11y: { name: 'Size' } },
								},
							],
						},
					},
				},
				null,
				'\t'
			)
		);
		await writeFile(
			join(dir, 'select.stories.js'),
			`import ${selectFixture};
const dynamicFields = Object.assign({});
export default {
	title: 'Components/Select',
	component: 'example-select',
	globals: { theme: 'dark' },
};
export const PlayFreeWithDarkGlobal = {
	parameters: { specimen: { patternSetup: { pattern: 'select', setup: 'default' } } },
	render: (_args, ctx) => {
		const el = document.createElement('example-select');
		// Expose the active theme global as the label so a theme leak fails the gate.
		el.setAttribute('label', ctx?.globals?.theme === 'light' ? 'Size' : 'WrongDarkTheme');
		return el;
	},
};
export const UnknownPlayStory = {
	...dynamicFields,
	parameters: { specimen: { patternSetup: { pattern: 'select', setup: 'default' } } },
	render: () => document.createElement('example-select'),
};
`
		);
		await writeFile(
			join(dir, 'native.js'),
			`import ${selectFixture};
export const Upper = { render: () => document.createElement('example-select') };
`
		);
		await writeFile(
			join(dir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						kind: 'javascript-module',
						path: 'select.js',
						declarations: [
							{ kind: 'class', name: 'S', tagName: 'example-select', customElement: true },
						],
					},
				],
			})
		);
		const oversizeId = `s-${'a'.repeat(190)}`;
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify(
				{
					manifest: './manifest.json',
					pack: {
						library: 'example',
						title: 'Example Library',
						prefix: 'example-',
						directory: './pack',
						package: '@example/lib',
					},
					stories: ['./select.stories.js'],
					specimens: [
						{
							id: 'UpperCase',
							title: 'Invalid/Upper',
							module: './native.js',
							exportName: 'Upper',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
						{
							id: oversizeId,
							title: 'Invalid/Oversize',
							module: './native.js',
							exportName: 'Upper',
							patternSetup: { pattern: 'select', setup: 'default' },
						},
					],
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			const validation = bench.validate();
			expect(validation.valid).toBe(false);
			// Uppercase and >200-char synthesized gate ids are rejected with PATTERN_SCHEMA_INVALID and not synthesized.
			expect(
				validation.issues.some((i) => i.code === 'PATTERN_SCHEMA_INVALID' && i.id === 'UpperCase')
			).toBe(true);
			expect(bench.list({ kind: 'gate', match: 'UpperCase' })).toHaveLength(0);
			expect(
				validation.issues.some((i) => i.code === 'PATTERN_SCHEMA_INVALID' && i.id === oversizeId)
			).toBe(true);
			expect(bench.list({ kind: 'gate', match: oversizeId })).toHaveLength(0);

			// Unknown-play story is rejected with PATTERN_SCHEMA_INVALID and not synthesized.
			expect(
				validation.issues.some(
					(i) =>
						i.code === 'PATTERN_SCHEMA_INVALID' && i.id === 'components-select--unknown-play-story'
				)
			).toBe(true);
			expect(bench.list({ kind: 'gate', match: 'unknown-play-story' })).toHaveLength(0);

			// Qualified local library filter matches the bound story in suite mode.
			const storySuite = suiteRunSchema.parse(
				await bench.runSuite({
					filter: { kind: ['story'], pattern: 'example/select' },
					capture: 'none',
					workers: 1,
				})
			);
			expect(storySuite.stories.map((s) => s.id)).toContain(
				'components-select--play-free-with-dark-global'
			);

			// Authoritative gate context (`theme: 'light'`) overrides story's `globals: { theme: 'dark' }`.
			const storyGate = gateRunSchema.parse(
				await bench.run({
					id: 'components-select--play-free-with-dark-global--gate--light-theme',
					capture: 'none',
				})
			);
			expect(storyGate.outcome).toEqual({ status: 'passed', failures: [] });
		} finally {
			await bench.close();
		}
	}, 90_000);

	it('auto-discovers missing pattern gaps in suggest({ component }) when pack.library is unset and disambiguates library-wide keep collisions', async () => {
		const dir = join(root, 'suggest-no-pack-lib');
		await mkdir(join(dir, 'specimens', 'patterns', 'select'), { recursive: true });
		await mkdir(join(dir, 'specimens', 'patterns', 'combobox'), { recursive: true });
		const sharedKeepPattern = (pattern: string): PatternFile => ({
			pattern,
			summary: `${pattern} pattern.`,
			status: 'stable',
			scope: 'control',
			setups: {
				default: {
					text: `Mount ${pattern}.`,
					targets: { control: { role: 'combobox', name: 'Size' } },
				},
			},
			keep: [{ id: 'shared.keep.named', text: 'Has accessible name.', gate: 'named' }],
			gates: {
				named: {
					setup: 'default',
					scenario: [{ id: 'check', expect: { target: 'control', a11y: { name: 'Size' } } }],
				},
			},
		});
		await writeFile(
			join(dir, 'specimens', 'patterns', 'select', 'pattern.json'),
			JSON.stringify(sharedKeepPattern('select'), null, '\t')
		);
		await writeFile(
			join(dir, 'specimens', 'patterns', 'combobox', 'pattern.json'),
			JSON.stringify(sharedKeepPattern('combobox'), null, '\t')
		);
		await writeFile(
			join(dir, 'manifest.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						kind: 'javascript-module',
						path: 'select.js',
						declarations: [
							{ kind: 'class', name: 'S', tagName: 'example-select', customElement: true },
						],
					},
				],
			})
		);
		await writeFile(
			join(dir, 'select.guide.json'),
			JSON.stringify({
				tag: 'example-select',
				summary: 'Select.',
				status: 'stable',
				implements: ['select'],
			})
		);
		await writeFile(
			join(dir, 'specimens.js'),
			`import ${selectFixture};
export const Plain = { render: () => document.createElement('example-select') };
`
		);
		// Intentionally omit `pack` (so `pack.library` is undefined -> defaults to `'local'`).
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify(
				{
					manifest: './manifest.json',
					guides: ['./select.guide.json'],
					specimens: [
						{
							id: 'plain-select',
							title: 'Plain',
							module: './specimens.js',
							exportName: 'Plain',
							component: 'example-select',
						},
					],
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			// Omitting `gaps` runs coverage, finds missing `shared.keep.named` on `select` while
			// `combobox` in the same library also declares `shared.keep.named`, and qualifies it
			// cleanly with `pattern:select:shared.keep.named` even with no `pack.library`.
			const suggested = await bench.suggest({ component: 'example-select', workers: 1 });
			const patternEntries = suggested.entries.filter((entry) => entry.patternSetup !== undefined);
			expect(patternEntries).toHaveLength(1);
			expect(patternEntries[0]?.patternSetup).toEqual({
				pattern: 'select',
				setup: 'default',
			});
			expect(suggested.skipped.filter((s) => s.obligation.startsWith('pattern:'))).toHaveLength(0);
		} finally {
			await bench.close();
		}
	}, 60_000);
});
