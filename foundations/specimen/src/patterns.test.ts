import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { validateSpecimen } from './browser/validate.js';
import { loadConfig } from './config.js';
import { type PACK_PATTERNS, packIdentifier } from './pack-schema.js';
import { patternFileSchema, patternJsonSchema } from './pattern-schema.js';
import { loadPatterns } from './patterns.js';
import type { ImplementationContexts, PatternSetupBinding, SpecimenEntry } from './types.js';

const schemaPath = fileURLToPath(new URL('../schema/pattern.schema.json', import.meta.url));
const roots: string[] = [];

async function makeProject(
	config: Record<string, unknown> = {},
	files: Record<string, string | Uint8Array> = {}
): Promise<string> {
	// The resolved path: on macOS `tmpdir()` is under `/var`, a link to `/private/var`, and the
	// pattern loader resolves links before checking that a path stays inside the root.
	const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-patterns-')));
	roots.push(root);
	await writeFile(
		join(root, 'example.specimen.js'),
		'export default { render: () => document.createElement("div") };\n'
	);
	const fullConfig = {
		specimens: [
			{
				id: 'example-select',
				title: 'Example select',
				module: './example.specimen.js',
				exportName: 'default',
			},
		],
		...config,
	};
	await writeFile(join(root, 'specimen.config.json'), JSON.stringify(fullConfig, null, '\t'));
	for (const [rel, content] of Object.entries(files)) {
		const target = join(root, rel);
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, content);
	}
	return root;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function validateProject(root: string, target?: { id?: string; file?: string }) {
	const bench = await createSpecimenBench({ root });
	try {
		return bench.validate(target);
	} finally {
		await bench.close();
	}
}

function validSelectPattern(overrides: Record<string, unknown> = {}) {
	return {
		pattern: 'select',
		summary: 'Choose one option from a popup list.',
		status: 'stable',
		scope: 'control',
		facets: {
			purpose: ['choice', 'form-input'],
			structure: ['popup'],
		},
		useWhen: [
			{ id: 'select.when.short-list', text: 'Use when choosing one item from a compact list.' },
		],
		avoidWhen: [{ id: 'select.avoid.two-choices', text: 'Avoid for a binary toggle.' }],
		keep: [
			{
				id: 'select.keep.escape-closes',
				text: 'Pressing Escape closes the popup and returns focus to the trigger.',
				gate: 'escape-closes',
			},
			{
				id: 'select.keep.clear-label',
				text: 'The trigger carries a visible label.',
			},
		],
		customize: [{ id: 'select.custom.option-layout', text: 'Options may show leading icons.' }],
		setups: {
			default: {
				text: 'Mount a labelled select with three options.',
				targets: {
					trigger: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' },
					apple: { role: 'option', name: 'Apple' },
				},
			},
		},
		gates: {
			'escape-closes': {
				setup: 'default',
				context: { viewport: { width: 800, height: 600 }, theme: 'light' },
				scenario: [
					{ id: 'open', action: { click: 'trigger' } },
					{ id: 'is-open', expect: { target: 'trigger', a11y: { expanded: true } } },
					{ id: 'close', action: { press: 'Escape' } },
					{ id: 'is-closed', expect: { target: 'trigger', a11y: { expanded: false } } },
					{ id: 'refocused', expect: { target: 'trigger', focus: true } },
				],
			},
		},
		...overrides,
	};
}

describe('ASCII format-2 identifier forms', () => {
	const idCases: Array<[keyof typeof PACK_PATTERNS, string[], string[]]> = [
		[
			'pattern',
			['select', 'dialog.modal', 'empty-collection', 'a1.b2-c3', 'a'.repeat(64)],
			['', 'Select', '1select', 'select..modal', 'select--one', 'select/', 'café', 'a'.repeat(65)],
		],
		[
			'qualifiedPattern',
			['violet/select', 'acme-ui/dialog.modal', `${'a'.repeat(64)}/${'b'.repeat(64)}`],
			[
				'select',
				'violet/',
				'/select',
				'Violet/select',
				'violet/Select',
				`${'a'.repeat(65)}/select`,
				`a/${'b'.repeat(65)}`,
				'violet/café',
			],
		],
		[
			'copyName',
			['collection-empty', 'v2', 'a'.repeat(64)],
			['', 'Collection', 'a.b', 'a--b', '-a', 'a-', 'a'.repeat(65)],
		],
		[
			'setup',
			['default', 'with-error', 'a'.repeat(64)],
			['', 'Default', 'a.b', 'a_b', 'a'.repeat(65)],
		],
		[
			'gate',
			['escape-closes', 'fits-narrow', 'a'.repeat(64)],
			['', 'Escape', 'a.b', 'a--b', 'a'.repeat(65)],
		],
		[
			'alias',
			['trigger', 'first-option', 'a'.repeat(64)],
			['', 'Trigger', 'a.b', '1trigger', 'a'.repeat(65)],
		],
		[
			'facetKey',
			['purpose', 'custom-axis', 'a'.repeat(64)],
			['', 'Purpose', 'a_b', 'a.b', 'a'.repeat(65)],
		],
		[
			'facetValue',
			['form-input', 'popup', 'a'.repeat(64)],
			['', 'Popup', 'a_b', 'a.b', 'a'.repeat(65)],
		],
		[
			'stepId',
			['open', 'check-focus-1', 'a'.repeat(64)],
			['', 'Open', 'a.b', 'a--b', 'a'.repeat(65)],
		],
	];

	it.each(idCases)('enforces %s boundaries and ASCII alphabet', (kind, valid, invalid) => {
		const schema = packIdentifier(kind);
		for (const sample of valid)
			expect(schema.safeParse(sample).success, `${kind}: ${sample}`).toBe(true);
		for (const sample of invalid)
			expect(schema.safeParse(sample).success, `${kind}: ${sample}`).toBe(false);
	});
});

describe('patternTarget and pattern.json schema', () => {
	it('accepts role sets (1..8 unique roles) and single name matchers, refusing conflicts', () => {
		const makeWithTarget = (target: unknown) =>
			validSelectPattern({
				setups: { default: { text: 'Setup.', targets: { trigger: target } } },
				gates: undefined,
				keep: undefined,
			});

		expect(patternFileSchema.safeParse(makeWithTarget({ role: 'button' })).success).toBe(true);
		expect(
			patternFileSchema.safeParse(makeWithTarget({ role: ['combobox', 'button'], name: 'Fruit' }))
				.success
		).toBe(true);
		expect(
			patternFileSchema.safeParse(
				makeWithTarget({ role: ['textbox', 'searchbox'], nameStartsWith: 'Search' })
			).success
		).toBe(true);
		expect(
			patternFileSchema.safeParse(makeWithTarget({ role: 'option', nameContains: 'Apple' })).success
		).toBe(true);

		const eightRoles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
		expect(patternFileSchema.safeParse(makeWithTarget({ role: eightRoles })).success).toBe(true);
		expect(
			patternFileSchema.safeParse(makeWithTarget({ role: [...eightRoles, 'i'] })).success
		).toBe(false);
		expect(patternFileSchema.safeParse(makeWithTarget({ role: [] })).success).toBe(false);
		expect(
			patternFileSchema.safeParse(makeWithTarget({ role: ['button', 'button'] })).success
		).toBe(false);

		// Mutually exclusive name matchers
		expect(
			patternFileSchema.safeParse(
				makeWithTarget({ role: 'button', name: 'A', nameStartsWith: 'A' })
			).success
		).toBe(false);
		expect(
			patternFileSchema.safeParse(makeWithTarget({ role: 'button', name: 'A', nameContains: 'A' }))
				.success
		).toBe(false);
		expect(
			patternFileSchema.safeParse(
				makeWithTarget({ role: 'button', nameStartsWith: 'A', nameContains: 'A' })
			).success
		).toBe(false);
	});

	it('enforces deprecation replacedBy, facets sorting, and a11y name matcher mutual exclusion', () => {
		expect(
			patternFileSchema.safeParse(
				validSelectPattern({ status: 'deprecated', replacedBy: 'violet/combobox' })
			).success
		).toBe(true);
		expect(
			patternFileSchema.safeParse(validSelectPattern({ status: 'stable', replacedBy: 'combobox' }))
				.success
		).toBe(false);
		expect(
			patternFileSchema.safeParse(validSelectPattern({ facets: { purpose: ['popup', 'choice'] } }))
				.success
		).toBe(false);
		expect(
			patternFileSchema.safeParse(
				validSelectPattern({
					gates: {
						bad: {
							setup: 'default',
							scenario: [
								{
									id: 'check',
									expect: { target: 'trigger', a11y: { name: 'Fruit', nameNonEmpty: true } },
								},
							],
						},
					},
					keep: undefined,
				})
			).success
		).toBe(false);
		expect(
			patternFileSchema.safeParse(
				validSelectPattern({
					gates: {
						bad: {
							setup: 'default',
							scenario: [
								{
									id: 'check',
									expect: { target: 'trigger', a11y: { name: 'Fruit', nameContains: 'Fr' } },
								},
							],
						},
					},
					keep: undefined,
				})
			).success
		).toBe(false);
	});

	it('commits pattern.schema.json matching patternJsonSchema() and validates with Ajv 2020-12', async () => {
		const committed = JSON.parse(await readFile(schemaPath, 'utf8'));
		const generated = patternJsonSchema();
		expect(committed).toEqual(generated);

		const ajv = new Ajv2020({ allErrors: true, strict: false });
		const validate = ajv.compile(generated as object);
		expect(validate(validSelectPattern()), ajv.errorsText()).toBe(true);
		expect(validate({ pattern: 'empty-collection', scope: 'composition' }), ajv.errorsText()).toBe(
			true
		);
		expect(validate({ pattern: 'select', scope: 'control', extra: true })).toBe(false);
		expect(validate(validSelectPattern({ status: 'stable', replacedBy: 'other' }))).toBe(false);
		expect(
			validate(validSelectPattern({ status: 'deprecated', replacedBy: `a/${'b'.repeat(64)}` })),
			ajv.errorsText()
		).toBe(true);
		expect(
			validate(validSelectPattern({ status: 'deprecated', replacedBy: `a/${'b'.repeat(65)}` }))
		).toBe(false);
		expect(
			validate(
				validSelectPattern({
					setups: {
						default: {
							text: 'Setup.',
							targets: { trigger: { role: 'button', name: 'A', nameContains: 'A' } },
						},
					},
					gates: undefined,
					keep: undefined,
				})
			)
		).toBe(false);
	});
});

describe('Job 5 (05-refuse-an-unportable-gate) and static validation error codes', () => {
	it('passes Job 5: valid select pattern passes and unportable listbox gate fails with exact bracket paths', async () => {
		const listboxPattern = {
			pattern: 'listbox',
			summary: 'Choose an item from a visible list.',
			scope: 'control',
			setups: {
				default: {
					text: 'Mount a listbox with two options.',
					targets: {
						list: { role: 'listbox', name: 'Size' },
					},
				},
			},
			gates: {
				'shows-choice': {
					setup: 'default',
					scenario: [
						{ id: 'pick', action: { click: { selector: 'example-option[selected]' } } },
						{
							id: 'check',
							expect: { target: 'list', state: { attribute: 'selected', equals: 'true' } },
						},
					],
				},
			},
		};
		const root = await makeProject(
			{},
			{
				'specimens/patterns/select/pattern.json': JSON.stringify(validSelectPattern(), null, '\t'),
				'specimens/patterns/listbox/pattern.json': JSON.stringify(listboxPattern, null, '\t'),
			}
		);

		const selectReport = await validateProject(root, {
			file: 'specimens/patterns/select/pattern.json',
		});
		expect(selectReport).toEqual({
			valid: true,
			scope: 'static',
			checked: 1,
			issues: [],
		});

		const listboxReport = await validateProject(root, {
			file: 'specimens/patterns/listbox/pattern.json',
		});
		expect(listboxReport.valid).toBe(false);
		expect(listboxReport.scope).toBe('static');
		expect(listboxReport.issues).toHaveLength(2);
		expect(listboxReport.issues[0]).toMatchObject({
			severity: 'error',
			code: 'GATE_NOT_PORTABLE',
			field: 'gates.shows-choice.scenario[0]',
		});
		expect(listboxReport.issues[0]?.suggestion).toContain('role');
		expect(listboxReport.issues[1]).toMatchObject({
			severity: 'error',
			code: 'GATE_NOT_PORTABLE',
			field: 'gates.shows-choice.scenario[1]',
		});
	});

	it('reports GATE_NOT_PORTABLE for setup selector, command step, capture step, and custom event', async () => {
		const pattern = {
			pattern: 'bad',
			scope: 'control',
			setups: {
				default: {
					text: 'Bad setup.',
					targets: {
						badTarget: { selector: 'example-select' },
						trigger: { role: 'button' },
					},
				},
			},
			gates: {
				unportable: {
					setup: 'default',
					scenario: [
						{ id: 'cmd', command: { runner: 'fast', name: 'open', target: 'trigger' } },
						{ capture: 'snap' },
						{ id: 'evt', expect: { event: 'violet-select-open', since: 'cmd' } },
					],
				},
			},
		};
		const root = await makeProject(
			{},
			{ 'specimens/patterns/bad/pattern.json': JSON.stringify(pattern, null, '\t') }
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.code, issue.field])).toEqual([
			['GATE_NOT_PORTABLE', 'setups.default.targets.badTarget'],
			['GATE_NOT_PORTABLE', 'gates.unportable.scenario[0]'],
			['GATE_NOT_PORTABLE', 'gates.unportable.scenario[1]'],
			['GATE_NOT_PORTABLE', 'gates.unportable.scenario[2]'],
		]);
	});

	it('accepts standard DOM events (input, change, submit, reset) with valid since ordering and rejects bad since ordering', async () => {
		const pattern = validSelectPattern({
			gates: {
				'dom-events': {
					setup: 'default',
					scenario: [
						{ id: 'act', action: { click: 'trigger' } },
						{ id: 'ok-change', expect: { event: 'change', target: 'trigger', since: 'act' } },
						{ id: 'ok-input', expect: { event: 'input', since: 'act', absent: true } },
						{ id: 'self-ref', expect: { event: 'submit', since: 'self-ref' } },
						{ id: 'forward-ref', expect: { event: 'reset', since: 'later' } },
						{ id: 'later', action: { focus: 'trigger' } },
					],
				},
			},
			keep: undefined,
		});
		const root = await makeProject(
			{},
			{ 'specimens/patterns/select/pattern.json': JSON.stringify(pattern, null, '\t') }
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.code, issue.field])).toEqual([
			['PATTERN_SCHEMA_INVALID', 'gates.dom-events.scenario[3].expect.since'],
			['PATTERN_SCHEMA_INVALID', 'gates.dom-events.scenario[4].expect.since'],
		]);
	});

	it('reports SETUP_UNKNOWN, GATE_UNKNOWN, TARGET_UNKNOWN, and DUPLICATE_ID inside patterns', async () => {
		const pattern = validSelectPattern({
			keep: [
				{ id: 'select.keep.dup', text: 'First.', gate: 'missing-gate' },
				{ id: 'select.keep.dup', text: 'Second.' },
			],
			gates: {
				'bad-refs': {
					setup: 'missing-setup',
					scenario: [{ id: 's1', action: { click: 'trigger' } }],
				},
				'bad-targets': {
					setup: 'default',
					scenario: [
						{ id: 'step-a', action: { click: 'ghost' } },
						{ id: 'step-a', action: { press: 'Enter', target: 'ghost-press' } },
						{ id: 'step-c', expect: { target: 'ghost-expect', focus: true } },
					],
				},
			},
		});
		const root = await makeProject(
			{},
			{ 'specimens/patterns/select/pattern.json': JSON.stringify(pattern, null, '\t') }
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.code, issue.field])).toEqual(
			expect.arrayContaining([
				['DUPLICATE_ID', 'keep[1].id'],
				['GATE_UNKNOWN', 'keep[0].gate'],
				['SETUP_UNKNOWN', 'gates.bad-refs.setup'],
				['TARGET_UNKNOWN', 'gates.bad-targets.scenario[0].action.click'],
				['DUPLICATE_ID', 'gates.bad-targets.scenario[1].id'],
				['TARGET_UNKNOWN', 'gates.bad-targets.scenario[1].action.target'],
				['TARGET_UNKNOWN', 'gates.bad-targets.scenario[2].expect.target'],
			])
		);
	});

	it('reports PATTERN_TEXT_TOO_LONG, PATTERN_TEXT_INVALID, PATTERN_JSON_INVALID, and parent-dir mismatch', async () => {
		const root = await makeProject(
			{ patterns: ['specimens/patterns/*/pattern.json'] },
			{
				'specimens/patterns/long/pattern.json': JSON.stringify({
					pattern: 'long',
					summary: 'x'.repeat(161),
					scope: 'control',
				}),
				'specimens/patterns/ctrl/pattern.json': JSON.stringify({
					pattern: 'ctrl',
					summary: 'line1\nline2',
					scope: 'control',
				}),
				'specimens/patterns/bidi/pattern.json': JSON.stringify({
					pattern: 'bidi',
					summary: 'safe \u202e override',
					scope: 'control',
				}),
				'specimens/patterns/badjson/pattern.json': '{ not json',
				'specimens/patterns/bom/pattern.json': new Uint8Array([
					0xef,
					0xbb,
					0xbf,
					...Buffer.from('{"pattern":"bom","scope":"control"}'),
				]),
				'specimens/patterns/wrong-dir/pattern.json': JSON.stringify({
					pattern: 'actual-name',
					scope: 'control',
				}),
			}
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		const pairs = report.issues.map((issue) => [issue.importPath, issue.code, issue.field]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/long/pattern.json',
			'PATTERN_TEXT_TOO_LONG',
			'summary',
		]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/ctrl/pattern.json',
			'PATTERN_TEXT_INVALID',
			'summary',
		]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/bidi/pattern.json',
			'PATTERN_TEXT_INVALID',
			'summary',
		]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/badjson/pattern.json',
			'PATTERN_JSON_INVALID',
			undefined,
		]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/bom/pattern.json',
			'PATTERN_JSON_INVALID',
			undefined,
		]);
		expect(pairs).toContainEqual([
			'./specimens/patterns/wrong-dir/pattern.json',
			'PATTERN_SCHEMA_INVALID',
			'pattern',
		]);
	});

	it('reports DUPLICATE_ID across pattern files, component guides, shared rules, and synthesized gate ids', async () => {
		const manifest = {
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
						},
					],
				},
			],
		};
		const root = await makeProject(
			{
				manifest: 'custom-elements.json',
				guides: ['src/*.guide.json'],
				patterns: ['patterns/*.pattern.json'],
				specimens: [
					{
						id: 'select-default',
						title: 'Select default',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { pattern: 'select', setup: 'default' },
					},
					{
						id: 'select-default--gate--escape-closes',
						title: 'Colliding explicit specimen',
						module: './example.specimen.js',
						exportName: 'default',
					},
				],
			},
			{
				'custom-elements.json': JSON.stringify(manifest),
				'src/example-select.guide.json': JSON.stringify({
					tag: 'example-select',
					usage: [{ id: 'shared.dup-guide', text: 'In guide.' }],
					implements: ['select', 'unknown-local'],
				}),
				'src/shared.guide.json': JSON.stringify({
					rules: [
						{
							id: 'shared.dup-rule',
							text: 'In shared rule.',
							appliesTo: { tags: ['example-select'] },
						},
					],
				}),
				'patterns/a.pattern.json': JSON.stringify(
					validSelectPattern({
						status: 'deprecated',
						replacedBy: 'missing-replacement',
						useWhen: [{ id: 'shared.dup-guide', text: 'Collides with guide.' }],
						avoidWhen: [{ id: 'shared.dup-rule', text: 'Collides with rule.' }],
					})
				),
				'patterns/b.pattern.json': JSON.stringify({
					pattern: 'select',
					scope: 'control',
				}),
			}
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.importPath, issue.code, issue.field])).toEqual(
			expect.arrayContaining([
				['./patterns/a.pattern.json', 'DUPLICATE_ID', 'useWhen[0].id'],
				['./patterns/a.pattern.json', 'DUPLICATE_ID', 'avoidWhen[0].id'],
				['./patterns/b.pattern.json', 'DUPLICATE_ID', 'pattern'],
				['./patterns/a.pattern.json', 'PATTERN_UNKNOWN', 'replacedBy'],
				['./src/example-select.guide.json', 'PATTERN_UNKNOWN', 'implements[1]'],
				['./example.specimen.js', 'DUPLICATE_ID', 'patternSetup'],
			])
		);
	});

	it('resolves patternSources offline from local pack directories and npm packages exporting ./pack', async () => {
		const externalPattern = {
			format: 2,
			...validSelectPattern(),
			implementations: [],
		};
		const root = await makeProject(
			{
				patternSources: ['./packs/local-pack', '@acme/design-pack'],
				specimens: [
					{
						id: 'from-local-pack',
						title: 'From local pack',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { library: 'local-lib', pattern: 'select', setup: 'default' },
					},
					{
						id: 'from-npm-pack',
						title: 'From npm pack',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { library: 'acme', pattern: 'select', setup: 'default' },
					},
					{
						id: 'bad-setup',
						title: 'Bad setup',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { library: 'acme', pattern: 'select', setup: 'nope' },
					},
					{
						id: 'bad-pattern',
						title: 'Bad pattern',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { library: 'unknown-lib', pattern: 'select', setup: 'default' },
					},
				],
			},
			{
				'packs/local-pack/data/local-lib/patterns/select.json': JSON.stringify(externalPattern),
				'node_modules/@acme/design-pack/package.json': JSON.stringify({
					name: '@acme/design-pack',
					version: '1.0.0',
					exports: { './pack': './pack' },
				}),
				'node_modules/@acme/design-pack/pack/data/acme/patterns/select.json':
					JSON.stringify(externalPattern),
			}
		);

		const loaded = await loadConfig({ root });
		expect(Object.keys(loaded.patterns?.external ?? {}).sort()).toEqual([
			'acme/select',
			'local-lib/select',
		]);

		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.id, issue.code, issue.field])).toEqual([
			['bad-setup', 'SETUP_UNKNOWN', 'patternSetup.setup'],
			['bad-pattern', 'PATTERN_UNKNOWN', 'patternSetup'],
		]);
		expect(await validateProject(root, { id: 'from-npm-pack' })).toMatchObject({
			valid: true,
			issues: [],
		});
		expect(await validateProject(root, { id: 'bad-setup' })).toMatchObject({
			valid: false,
			issues: [{ id: 'bad-setup', code: 'SETUP_UNKNOWN', field: 'patternSetup.setup' }],
		});
	});

	it('reports PATTERN_UNREADABLE for missing patternSources, bad package exports, or missing literal pattern files', async () => {
		const root = await makeProject(
			{
				patterns: ['specimens/patterns/missing/pattern.json', '../escape/*.json'],
				patternSources: ['./no-such-pack', '@acme/missing-pkg', '@acme/no-export-pkg'],
			},
			{
				'node_modules/@acme/no-export-pkg/package.json': JSON.stringify({
					name: '@acme/no-export-pkg',
					version: '1.0.0',
					exports: { '.': './index.js' },
				}),
			}
		);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.filter((issue) => issue.code === 'PATTERN_UNREADABLE')).toHaveLength(5);
	});

	it('refuses play-bearing retained stories bound as pattern setups with PATTERN_SCHEMA_INVALID', async () => {
		const root = await makeProject(
			{},
			{
				'specimens/patterns/select/pattern.json': JSON.stringify(validSelectPattern(), null, '\t'),
			}
		);
		const entries: SpecimenEntry[] = [
			{
				id: 'select--clean',
				title: 'Components/Select',
				module: './src/select.stories.ts',
				exportName: 'Clean',
				story: {
					name: 'Clean',
					tags: ['dev', 'test'],
					play: 'absent',
					unresolved: [],
					annotations: { meta: ['title'], story: ['parameters'] },
				},
			},
			{
				id: 'select--with-play',
				title: 'Components/Select',
				module: './src/select.stories.ts',
				exportName: 'WithPlay',
				story: {
					name: 'WithPlay',
					tags: ['dev', 'test', 'play-fn'],
					play: 'present',
					unresolved: [],
					annotations: { meta: ['title'], story: ['parameters', 'play'] },
				},
			},
		];
		const loaded = await loadPatterns({
			root,
			configFile: join(root, 'specimen.config.json'),
			entries,
			storyBindings: [
				{ id: 'select--clean', patternSetup: { pattern: 'select', setup: 'default' } },
				{ id: 'select--with-play', patternSetup: { pattern: 'select', setup: 'default' } },
			],
		});
		expect(loaded.problems).toEqual([
			expect.objectContaining({
				severity: 'error',
				code: 'PATTERN_SCHEMA_INVALID',
				id: 'select--with-play',
				file: './src/select.stories.ts',
				exportName: 'WithPlay',
				field: 'parameters.specimen.patternSetup',
			}),
		]);
	});

	it('never throws on malformed gates, preserves gate-step text codes, and enforces file-scoped missing literal errors', async () => {
		const root = await makeProject(
			{
				patterns: [
					'specimens/patterns/broken/pattern.json',
					'specimens/patterns/text-in-step/pattern.json',
					'specimens/patterns/missing/pattern.json',
					'specimens/patterns/patterns/pattern.json',
					'contracts/widgets/pattern.json',
				],
				specimens: [
					{
						id: 'bound-broken',
						title: 'Bound to broken pattern',
						module: './example.specimen.js',
						exportName: 'default',
						patternSetup: { pattern: 'broken', setup: 'default' },
					},
				],
			},
			{
				'specimens/patterns/broken/pattern.json': JSON.stringify({
					pattern: 'broken',
					scope: 'control',
					setups: { default: { text: 'Ok.', targets: { t: { role: 'button' } } } },
					gates: { bad: null },
				}),
				'specimens/patterns/text-in-step/pattern.json': JSON.stringify({
					pattern: 'text-in-step',
					scope: 'control',
					setups: { default: { text: 'Ok.', targets: { t: { role: 'textbox' } } } },
					gates: {
						check: {
							setup: 'default',
							scenario: [
								{ id: 'too-long', action: { fill: 't', value: 'x'.repeat(241) } },
								{
									id: 'bidi',
									expect: { target: 't', a11y: { nameContains: 'bad \u202e text' } },
								},
							],
						},
					},
				}),
				'specimens/patterns/patterns/pattern.json': JSON.stringify({
					pattern: 'select',
					scope: 'control',
				}),
				'contracts/widgets/pattern.json': JSON.stringify({
					pattern: 'custom-widget',
					scope: 'control',
				}),
			}
		);

		const full = await validateProject(root);
		expect(full.valid).toBe(false);
		const issues = full.issues.map((item) => [item.importPath, item.code, item.field]);
		expect(issues).toContainEqual([
			'./specimens/patterns/broken/pattern.json',
			'PATTERN_SCHEMA_INVALID',
			'gates.bad',
		]);
		expect(issues).toContainEqual([
			'./specimens/patterns/text-in-step/pattern.json',
			'PATTERN_TEXT_TOO_LONG',
			'gates.check.scenario[0].action.value',
		]);
		expect(issues).toContainEqual([
			'./specimens/patterns/text-in-step/pattern.json',
			'PATTERN_TEXT_INVALID',
			'gates.check.scenario[1].expect.a11y.nameContains',
		]);
		expect(issues).toContainEqual([
			'./specimens/patterns/patterns/pattern.json',
			'PATTERN_SCHEMA_INVALID',
			'pattern',
		]);
		// Custom non-default path is NOT bound by the default-layout parent-directory rule.
		expect(
			full.issues.filter((item) => item.importPath === './contracts/widgets/pattern.json')
		).toEqual([]);

		// File-scoped validation on a missing literal file returns valid: false with PATTERN_UNREADABLE.
		const missingReport = await validateProject(root, {
			file: 'specimens/patterns/missing/pattern.json',
		});
		expect(missingReport.valid).toBe(false);
		expect(missingReport.issues).toEqual([
			expect.objectContaining({
				code: 'PATTERN_UNREADABLE',
				importPath: './specimens/patterns/missing/pattern.json',
			}),
		]);
	});

	it('validates imported patternSources semantics, conditional/wildcard/escaping exports, and resolved guide duplicates', async () => {
		const badExternal = validSelectPattern({
			gates: {
				broken: {
					setup: 'default',
					scenario: [{ id: 'self', expect: { event: 'change', since: 'self' } }],
				},
			},
			keep: undefined,
		});
		const goodExternal = { format: 2, ...validSelectPattern(), implementations: [] };
		const manifest = {
			schemaVersion: '1.0.0',
			modules: [
				{
					path: 'select.js',
					declarations: [
						{ kind: 'class', name: 'AcmeSelect', tagName: 'acme-select', customElement: true },
					],
				},
			],
		};
		const root = await makeProject(
			{
				manifest: 'custom-elements.json',
				guides: ['src/*.guide.json'],
				patterns: ['specimens/patterns/*/pattern.json'],
				pack: {
					library: 'acme',
					title: 'Acme',
					prefix: 'acme-',
					directory: './pack',
					package: './package.json',
				},
				patternSources: ['@pkg/cond', '@pkg/wild', '@pkg/escape', './packs/bad-sem'],
			},
			{
				'custom-elements.json': JSON.stringify(manifest),
				'package.json': JSON.stringify({ name: 'acme-app', version: '1.0.0' }),
				'specimens/patterns/select/pattern.json': JSON.stringify(validSelectPattern()),
				'src/acme-select.guide.json': JSON.stringify({
					tag: 'acme-select',
					implements: ['select', { library: 'acme', pattern: 'select' }],
				}),
				'packs/bad-sem/data/badlib/patterns/select.json': JSON.stringify(badExternal),
				'node_modules/@pkg/cond/package.json': JSON.stringify({
					name: '@pkg/cond',
					version: '1.0.0',
					exports: { './pack': { node: './node-pack', default: './default-pack' } },
				}),
				'node_modules/@pkg/cond/node-pack/data/condlib/patterns/select.json':
					JSON.stringify(goodExternal),
				'node_modules/@pkg/wild/package.json': JSON.stringify({
					name: '@pkg/wild',
					version: '1.0.0',
					exports: { './*': './exported/*' },
				}),
				'node_modules/@pkg/wild/exported/pack/data/wildlib/patterns/select.json':
					JSON.stringify(goodExternal),
				'node_modules/@pkg/escape/package.json': JSON.stringify({
					name: '@pkg/escape',
					version: '1.0.0',
					exports: { './pack': '../../../packs/bad-sem' },
				}),
			}
		);

		const loaded = await loadConfig({ root });
		expect(Object.keys(loaded.patterns?.external ?? {}).sort()).toEqual([
			'condlib/select',
			'wildlib/select',
		]);
		const report = await validateProject(root);
		expect(report.valid).toBe(false);
		expect(report.issues.map((item) => [item.code, item.field])).toEqual(
			expect.arrayContaining([
				['PATTERN_SCHEMA_INVALID', 'gates.broken.scenario[0].expect.since'],
				['PATTERN_UNREADABLE', undefined],
				['DUPLICATE_ID', 'implements[1]'],
			])
		);
	});

	it('accepts patternSetup and contexts on native SpecimenDefinition modules in browser validation', () => {
		const validated = validateSpecimen(
			{
				Default: {
					render: () => ({}) as HTMLElement,
					patternSetup: { library: 'violet', pattern: 'select', setup: 'default' },
					contexts: {
						viewport: { minWidth: 320, maxWidth: 1280 },
						themes: ['dark', 'light'],
						reason: 'Standard viewport range.',
					},
				},
			},
			'Default'
		);
		expect(validated.specimen.patternSetup).toEqual({
			library: 'violet',
			pattern: 'select',
			setup: 'default',
		});
		expect(validated.specimen.contexts).toEqual({
			viewport: { minWidth: 320, maxWidth: 1280 },
			themes: ['dark', 'light'],
			reason: 'Standard viewport range.',
		});
		expect(() =>
			validateSpecimen(
				{
					BadSetup: {
						render: () => ({}) as HTMLElement,
						patternSetup: 'select/default' as unknown as PatternSetupBinding,
					},
				},
				'BadSetup'
			)
		).toThrow('specimen.patternSetup');
		expect(() =>
			validateSpecimen(
				{
					BadContexts: {
						render: () => ({}) as HTMLElement,
						contexts: ['dark'] as unknown as ImplementationContexts,
					},
				},
				'BadContexts'
			)
		).toThrow('specimen.contexts');
	});
});
