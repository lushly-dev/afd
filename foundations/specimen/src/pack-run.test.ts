import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './index.js';
import { readPackFiles } from './pack.js';
import { exampleMarkup } from './pack-run.js';
import { packCheckRunSchema, packRunSchema } from './schema.js';

/**
 * `specimen pack` on the example library: built from its cases, its committed form is the format's
 * fixture pack, byte for byte, on any system the suite runs on.
 */
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const decoder = new TextDecoder();
/** A test that builds the pack more than once: each build runs every case twice. */
const SEVERAL_BUILDS = 120_000;

/** The example library and its committed pack, copied so a test may change them. */
async function copy(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'specimen-pack-'));
	await cp(join(fixtures, 'pack-library'), join(root, 'pack-library'), {
		recursive: true,
		// A full build's index is a cache: a copy starts without one.
		filter: (source) => !source.includes('node_modules'),
	});
	await cp(join(fixtures, 'pack/committed'), join(root, 'pack/committed'), { recursive: true });
	return root;
}

describe('specimen pack', () => {
	let bench: SpecimenBench;
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: join(fixtures, 'pack-library') });
	});
	afterAll(async () => {
		await bench?.close();
	});

	it('builds the format’s fixture pack from the example library, byte for byte', async () => {
		const run = await bench.packCheck({ workers: 1 });
		expect(packCheckRunSchema.parse(run)).toEqual(run);
		expect(run.problems).toEqual([]);
		expect({ changed: run.changed, added: run.added, removed: run.removed }).toEqual({
			changed: [],
			added: [],
			removed: [],
		});
		expect(run.valid).toBe(true);
		expect(run.cases).toMatchObject({ total: 9, passed: 9, failed: [], unstable: [] });
		expect(run.examples).toEqual({ kept: 3, leftOut: [] });
		expect(run.guides).toMatchObject({ verified: 2, invalidClaims: [] });
		expect(run.components).toEqual([
			{
				tag: 'example-dropdown',
				gaps: [
					{ kind: 'summary' },
					{ kind: 'usage' },
					{ kind: 'a11y-statement' },
					{ kind: 'role' },
					{ kind: 'example' },
					{ kind: 'unobserved', section: 'attributes', name: 'value' },
				],
			},
			{ tag: 'example-field', gaps: [] },
			{ tag: 'example-option', gaps: [{ kind: 'a11y-statement' }, { kind: 'example' }] },
			{
				tag: 'example-select',
				gaps: [{ kind: 'unobserved', section: 'attributes', name: 'required' }],
			},
		]);
	});

	it(
		'names the record a changed fixture differs in, and passes after a version bump',
		async () => {
			const root = await copy();
			const changed = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const record = join(root, 'pack/committed/data/example/components/example-select.json');
				await writeFile(record, (await readFile(record, 'utf8')).replace('"preview"', '"stable"'));
				const run = await changed.packCheck({ workers: 1 });
				expect(run.valid).toBe(false);
				expect(run.changed).toEqual(['data/example/components/example-select.json']);
				// Writing it puts back what the run showed, and nothing else.
				const written = packRunSchema.parse(await changed.pack({ workers: 1 }));
				expect(written.written).toEqual(['data/example/components/example-select.json']);
				expect(await readFile(record, 'utf8')).toBe(
					await readFile(
						join(fixtures, 'pack/committed/data/example/components/example-select.json'),
						'utf8'
					)
				);
			} finally {
				await changed.close();
			}
			// A record holds no version, so a new version of the library changes no record.
			const manifest = join(root, 'pack-library/library.json');
			await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('1.0.0', '2.0.0'));
			const bumped = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				expect((await bumped.packCheck({ workers: 1 })).valid).toBe(true);
			} finally {
				await bumped.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'refuses to write, and fails the check, when a guide has an error',
		async () => {
			const root = await copy();
			const guide = join(root, 'pack-library/guides/field.guide.json');
			const parsed = JSON.parse(await readFile(guide, 'utf8')) as { summary: string };
			parsed.summary = 'x'.repeat(400);
			await writeFile(guide, JSON.stringify(parsed));
			const broken = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const check = await broken.packCheck({ workers: 1 });
				expect(check.valid).toBe(false);
				expect(check.problems).toEqual([
					expect.objectContaining({
						code: 'GUIDE_TEXT_TOO_LONG',
						path: './guides/field.guide.json',
					}),
				]);
				await expect(broken.pack({ workers: 1 })).rejects.toThrow(/GUIDE_TEXT_TOO_LONG/);
			} finally {
				await broken.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	// The Component Briefs proposal's exit criteria 4 and 5, on the example library.
	it(
		'drops a fact to its unchecked basis when the claim that verified it fails',
		async () => {
			const root = await copy();
			const cases = join(root, 'pack-library/specimens.js');
			await writeFile(
				cases,
				(await readFile(cases, 'utf8')).replace(
					"state: { attribute: 'label', equals: 'Name' }",
					"state: { attribute: 'label', equals: 'Other' }"
				)
			);
			const broken = await createSpecimenBench({ root: join(root, 'pack-library') });
			const path = 'data/example/components/example-field.json';
			const statement = (record: string) =>
				(
					JSON.parse(record) as { a11y: { statements: { id: string; basis: string }[] } }
				).a11y.statements.find((item) => item.id === 'field.label-required')?.basis;
			try {
				expect(statement(await readFile(join(fixtures, 'pack/committed', path), 'utf8'))).toBe(
					'verified'
				);
				const run = await broken.pack({ workers: 1, allowFailed: ['checks--field-states'] });
				expect(run.cases.failed.map((item) => item.id)).toEqual(['checks--field-states']);
				expect(run.written).toContain(path);
				expect(statement(await readFile(join(root, 'pack/committed', path), 'utf8'))).toBe(
					'authored'
				);
			} finally {
				await broken.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'fails the check when a component changes and its record is not rebuilt',
		async () => {
			const root = await copy();
			const manifest = join(root, 'pack-library/custom-elements.json');
			await writeFile(
				manifest,
				(await readFile(manifest, 'utf8'))
					.split("The field's visible label and accessible name.")
					.join("The field's label, which names it.")
			);
			const changed = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const run = await changed.packCheck({ workers: 1 });
				expect(run.valid).toBe(false);
				expect(run.changed).toEqual(['data/example/components/example-field.json']);
			} finally {
				await changed.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'changes, after a story edit, only the records of the tags that story renders',
		async () => {
			const root = await copy();
			const cases = join(root, 'pack-library/specimens.js');
			// The select's own case renders the select and its options, and nothing else.
			await writeFile(
				cases,
				(await readFile(cases, 'utf8')).replace(
					'<example-select label="Size" value="m">',
					'<example-select label="Size" value="m" required>'
				)
			);
			const edited = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const run = await edited.pack({ workers: 1 });
				expect(run.written.length).toBeGreaterThan(0);
				for (const path of run.written)
					expect([
						'data/example/components/example-option.json',
						'data/example/components/example-select.json',
					]).toContain(path);
			} finally {
				await edited.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'rebuilds one component from the cases a full build indexed, equal to its record from that build',
		async () => {
			const root = await copy();
			const one = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const before = await one.packCheck({ workers: 1, component: 'example-option' });
				expect(before.selection.reason).toMatch(/No full build has written an index/);
				expect((await one.packCheck({ workers: 1 })).valid).toBe(true);
				// No story names the option: only the select's cases render it.
				const run = await one.packCheck({ workers: 1, component: 'example-option' });
				expect(run.selection).toEqual({
					component: 'example-option',
					complete: true,
					reason:
						"The last full build's index lists 3 cases that render it, and the sources have not changed since.",
				});
				expect(run.cases.total).toBe(3);
				expect(run.valid).toBe(true);
				expect(run.components.map((item) => item.tag)).toEqual(['example-option']);
			} finally {
				await one.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'takes nothing from a case that differs between passes, fails, or whose example does not mount again',
		async () => {
			const root = await copy();
			const variants = await createSpecimenBench({
				root: join(root, 'pack-library'),
				configFile: 'specimen.variants.json',
			});
			const before = await readPackFiles(join(root, 'pack/committed'));
			try {
				const run = await variants.packCheck({ workers: 1 });
				expect(run.cases.unstable).toEqual(['variants--unstable']);
				expect(run.cases.failed.map((item) => item.id)).toEqual(['variants--broken']);
				expect(run.cases.retried).toEqual(['variants--broken']);
				expect(run.examples.leftOut).toEqual([
					{
						tag: 'example-field',
						from: 'example-field--property-named',
						reason: 'Mounted again from its markup, it shows something else.',
					},
				]);
				expect(run.valid).toBe(false);
				// A run with a failed case writes nothing unless the case is named.
				await expect(variants.pack({ workers: 1 })).rejects.toThrow(
					/No pack was written\. 1 case failed: variants--broken/
				);
				expect(await readPackFiles(join(root, 'pack/committed'))).toEqual(before);
				const allowed = await variants.pack({ workers: 1, allowFailed: ['variants--broken'] });
				expect(allowed.cases.failed.map((item) => item.id)).toEqual(['variants--broken']);
				// The unstable case's value never reaches the record: it showed one in each pass.
				const field = decoder.decode(
					(await readPackFiles(join(root, 'pack/committed'))).get(
						'data/example/components/example-field.json'
					)
				);
				expect(field).not.toContain('Token');
				// The dropdown keeps its control, a button, in its shadow tree: its role is that
				// button's, with no word on its name, which the dropdown's own attributes do not give.
				const dropdown = JSON.parse(
					decoder.decode(
						(await readPackFiles(join(root, 'pack/committed'))).get(
							'data/example/components/example-dropdown.json'
						)
					)
				);
				expect(dropdown.a11y.role).toEqual([
					{ state: 'default', role: 'button', basis: 'observed' },
				]);
			} finally {
				await variants.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'refuses to write with PATTERN_SETUP_MISSING when an implemented pattern lacks a gated setup',
		async () => {
			const root = await copy();
			const configPath = join(root, 'pack-library/specimen.config.json');
			const config = JSON.parse(await readFile(configPath, 'utf8')) as {
				specimens: Array<Record<string, unknown>>;
			};
			// Remove the `invalid` setup binding for example-field so `field/invalid` is missing.
			for (const entry of config.specimens) {
				if (entry.id === 'example-field--invalid') {
					delete entry.patternSetup;
				}
			}
			await writeFile(configPath, JSON.stringify(config, null, '\t'));
			const before = await readPackFiles(join(root, 'pack/committed'));
			const missing = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const check = await missing.packCheck({ workers: 1 });
				expect(check.valid).toBe(false);
				expect(check.problems).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							code: 'PATTERN_SETUP_MISSING',
							message: expect.stringContaining('example/field'),
						}),
					])
				);
				await expect(missing.pack({ workers: 1 })).rejects.toMatchObject({
					code: 'PATTERN_SETUP_MISSING',
					suggestion: expect.stringContaining('specimen-suggest'),
				});
				expect(await readPackFiles(join(root, 'pack/committed'))).toEqual(before);
			} finally {
				await missing.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'refuses to write with GATE_FAILED when a pattern gate fails, even with allowFailed',
		async () => {
			const root = await copy();
			const cases = join(root, 'pack-library/specimens.js');
			await writeFile(
				cases,
				(await readFile(cases, 'utf8')).replace(
					'<example-select label="Size" value="m">',
					'<example-select label="Size" value="m" disabled>'
				)
			);
			const before = await readPackFiles(join(root, 'pack/committed'));
			const broken = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const check = await broken.packCheck({ workers: 1 });
				expect(check.valid).toBe(false);
				expect(check.problems).toEqual(
					expect.arrayContaining([expect.objectContaining({ code: 'GATE_FAILED' })])
				);
				await expect(
					broken.pack({
						workers: 1,
						allowFailed: ['example-select--default--gate--escape-closes'],
					})
				).rejects.toThrow(/GATE_FAILED/);
				expect(await readPackFiles(join(root, 'pack/committed'))).toEqual(before);
			} finally {
				await broken.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'builds a pattern-only format 2 pack with zero components',
		async () => {
			const root = await mkdtemp(join(tmpdir(), 'specimen-pack-patterns-only-'));
			const { mkdir: mk } = await import('node:fs/promises');
			try {
				await mk(join(root, 'patterns/confirm'), { recursive: true });
				await mk(join(root, 'pack'), { recursive: true });
				await writeFile(
					join(root, 'package.json'),
					JSON.stringify({ name: 'app-patterns', version: '1.0.0', type: 'module' })
				);
				await writeFile(
					join(root, 'patterns/confirm/pattern.json'),
					JSON.stringify({
						pattern: 'confirm',
						summary: 'Confirm a destructive action before applying it.',
						scope: 'composition',
						facets: { purpose: ['confirmation'] },
						useWhen: [{ id: 'pattern.confirm.use', text: 'Use before irreversible actions.' }],
						avoidWhen: [],
						keep: [
							{ id: 'pattern.confirm.explicit', text: 'Name the action on the confirm button.' },
						],
						customize: [],
						setups: {},
						gates: {},
					})
				);
				await writeFile(
					join(root, 'app.js'),
					'export const Screen = { render: () => { const d = document.createElement("div"); d.textContent = "Confirm"; return d; } };\n'
				);
				await writeFile(
					join(root, 'specimen.config.json'),
					JSON.stringify({
						specimens: [
							{ id: 'app--screen', title: 'App/Screen', module: './app.js', exportName: 'Screen' },
						],
						patterns: ['./patterns/**/pattern.json'],
						pack: {
							library: 'myapp',
							title: 'My App Patterns',
							prefix: 'myapp-',
							package: './package.json',
							directory: './pack',
							localElements: { tags: ['myapp-dialog'] },
						},
					})
				);
				const appBench = await createSpecimenBench({ root });
				try {
					const written = await appBench.pack({ workers: 1 });
					expect(written.problems).toEqual([]);
					expect(written.written.sort()).toEqual([
						'data/myapp/patterns/confirm.json',
						'rules/myapp.json',
					]);
					const exported = await appBench.packExport({ directory: join(root, 'exported') });
					expect(exported.files).toContain('data/myapp/library.json');
					expect(exported.files).toContain('data/myapp/patterns/confirm.json');
				} finally {
					await appBench.close();
				}
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);
});

describe('an example’s markup', () => {
	it('leaves out shadow content and writes an empty attribute as its name', () => {
		expect(
			exampleMarkup(
				'<example-field label="Email" invalid=""><template shadowrootmode="open"><span part="value"></span><slot name="hint"></slot></template>\n\t<span slot="hint">Why.</span>\n</example-field>'
			)
		).toBe(
			'<example-field invalid label="Email">\n\t<span slot="hint">Why.</span>\n</example-field>'
		);
	});

	it('writes each element’s attributes in name order, however the page set them', () => {
		const one =
			'<x-item heading-level="3" expanded=""><span slot="heading" class="a b">A</span></x-item>';
		const two =
			'<x-item expanded="" heading-level="3"><span class="a b" slot="heading">A</span></x-item>';
		expect(exampleMarkup(one)).toBe(
			'<x-item expanded heading-level="3"><span class="a b" slot="heading">A</span></x-item>'
		);
		expect(exampleMarkup(two)).toBe(exampleMarkup(one));
	});
});
